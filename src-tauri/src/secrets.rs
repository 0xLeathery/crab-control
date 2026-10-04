//! Secret detection + masking. SAFETY RULE: never display credentials, tokens,
//! API keys, or anything that looks like one. This module masks values before
//! they ever reach the webview. We never open credential stores at all
//! (e.g. ~/.claude/.credentials.json, the macOS keychain) — those paths are
//! simply not read anywhere in the app.

use serde_json::Value;

/// Files we refuse to read no matter what (defense in depth). Matched on the
/// final path component.
pub const FORBIDDEN_FILES: &[&str] = &[".credentials.json", "credentials.json"];

pub fn is_forbidden_file(name: &str) -> bool {
    FORBIDDEN_FILES.iter().any(|f| f.eq_ignore_ascii_case(name))
}

/// Does this object key name suggest its value is a secret?
pub fn is_secret_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    const NEEDLES: &[&str] = &[
        "secret",
        "token",
        "password",
        "passwd",
        "apikey",
        "api_key",
        "api-key",
        "credential",
        "private_key",
        "privatekey",
        "access_key",
        "client_secret",
        "auth",
        "bearer",
        "session",
        "cookie",
    ];
    if NEEDLES.iter().any(|n| k.contains(n)) {
        return true;
    }
    // A bare "key" is secret-ish in env contexts, but not for things like
    // "publicKey" / "keybindings" / "hotkey". Match only when it's the whole
    // token or an explicit *_key / key_* form.
    k == "key" || k.ends_with("_key") || k.starts_with("key_")
}

/// Does a string value itself look like a secret token, regardless of its key?
pub fn looks_like_secret(s: &str) -> bool {
    let t = s.trim();
    if t.len() < 16 {
        return false;
    }
    // Common prefixes for provider tokens.
    const PREFIXES: &[&str] = &[
        "sk-",
        "sk_",
        "pk-",
        "rk_",
        "ghp_",
        "gho_",
        "ghs_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "ib_",
        "AKIA",
        "ASIA",
        "AIza",
        "ya29.",
        "Bearer ",
        "glpat-",
    ];
    if PREFIXES.iter().any(|p| t.starts_with(p)) {
        return true;
    }
    // JWT: three base64url segments separated by dots.
    let dots = t.matches('.').count();
    if dots == 2
        && t.len() > 40
        && t.split('.').all(|seg| {
            !seg.is_empty()
                && seg
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
    {
        return true;
    }
    false
}

/// Mask a secret string, keeping a tiny hint of length/shape.
pub fn mask_str(s: &str) -> String {
    let n = s.chars().count();
    if n == 0 {
        return String::new();
    }
    if n <= 6 {
        return "••••".to_string();
    }
    let head: String = s.chars().take(3).collect();
    format!("{head}••••••({n})")
}

/// Mask secret-looking query parameters inside a URL string in place.
/// e.g. https://x/api?key=ib_abc&q=1  ->  https://x/api?key=••••&q=1
pub fn mask_url(url: &str) -> String {
    let Some(qpos) = url.find('?') else {
        return url.to_string();
    };
    let (base, query) = url.split_at(qpos);
    let query = &query[1..]; // drop '?'
    let mut out = String::new();
    for (i, pair) in query.split('&').enumerate() {
        if i > 0 {
            out.push('&');
        }
        if let Some((k, v)) = pair.split_once('=') {
            if is_secret_key(k) || looks_like_secret(v) {
                out.push_str(k);
                out.push('=');
                out.push_str("••••");
            } else {
                out.push_str(pair);
            }
        } else {
            out.push_str(pair);
        }
    }
    format!("{base}?{out}")
}

/// Recursively mask a JSON value for safe display. `key_hint` is the key under
/// which this value sits (drives key-based masking); pass None at the root.
pub fn mask_value(value: &Value, key_hint: Option<&str>) -> Value {
    match value {
        Value::String(s) => {
            let secret_key = key_hint.map(is_secret_key).unwrap_or(false);
            if secret_key || looks_like_secret(s) {
                Value::String(mask_str(s))
            } else if s.contains("://") && s.contains('?') {
                Value::String(mask_url(s))
            } else {
                Value::String(s.clone())
            }
        }
        Value::Array(items) => {
            Value::Array(items.iter().map(|it| mask_value(it, key_hint)).collect())
        }
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                // Anything nested under an "env"/"headers"/"environment" block
                // is treated as secret-bearing: mask all of its string values.
                let force = matches!(
                    key_hint,
                    Some("env") | Some("headers") | Some("environment") | Some("envVars")
                );
                if force && v.is_string() {
                    out.insert(k.clone(), Value::String(mask_str(v.as_str().unwrap())));
                } else {
                    out.insert(k.clone(), mask_value(v, Some(k)));
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn forbidden_files_match_case_insensitively() {
        assert!(is_forbidden_file(".credentials.json"));
        assert!(is_forbidden_file("Credentials.JSON"));
        assert!(!is_forbidden_file("settings.json"));
    }

    #[test]
    fn secret_key_names() {
        for k in [
            "API_KEY",
            "apiKey",
            "GITHUB_TOKEN",
            "client_secret",
            "Authorization",
            "key",
            "aws_access_key",
            "key_id",
        ] {
            assert!(is_secret_key(k), "{k} should be secret");
        }
        for k in [
            "publicKey",
            "keybindings",
            "hotkey",
            "model",
            "theme",
            "command",
        ] {
            assert!(!is_secret_key(k), "{k} should not be secret");
        }
    }

    #[test]
    fn secret_looking_values() {
        for v in [
            "sk-ant-abcdefghijklmnop",
            "ghp_abcdefghijklmnopqrst",
            "AKIAABCDEFGHIJKLMNOP",
            "Bearer abcdefghijklmnop",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
        ] {
            assert!(looks_like_secret(v), "{v} should look secret");
        }
        for v in [
            "sk-short",
            "claude-sonnet-model-name",
            "https://example.com/a.b.c",
            "npx -y some-mcp-server",
        ] {
            assert!(!looks_like_secret(v), "{v} should not look secret");
        }
    }

    #[test]
    fn mask_str_hides_all_but_a_short_prefix() {
        assert_eq!(mask_str(""), "");
        assert_eq!(mask_str("abc"), "••••");
        let m = mask_str("sk-ant-abcdefghijklmnop");
        assert_eq!(m, "sk-••••••(23)");
        assert!(!m.contains("abcdef"));
    }

    #[test]
    fn mask_url_masks_secret_query_params_only() {
        assert_eq!(
            mask_url("https://x.dev/api?key=ib_abc&q=1"),
            "https://x.dev/api?key=••••&q=1"
        );
        assert_eq!(
            mask_url("https://x.dev/api?q=ghp_abcdefghijklmnopqrst"),
            "https://x.dev/api?q=••••"
        );
        assert_eq!(mask_url("https://x.dev/api"), "https://x.dev/api");
    }

    #[test]
    fn mask_value_masks_env_headers_and_secret_keys_recursively() {
        let v = json!({
            "model": "opus",
            "env": { "DEBUG": "1", "ANTHROPIC_API_KEY": "sk-ant-abcdefghijklmnop" },
            "mcpServers": {
                "s": {
                    "url": "https://x.dev/mcp?token=abc&v=2",
                    "headers": { "Authorization": "Bearer abcdefghijklmnop" },
                    "apiKey": "plainvalue"
                }
            },
            "count": 3
        });
        let m = mask_value(&v, None);
        let s = m.to_string();
        assert_eq!(m["model"], "opus");
        assert_eq!(m["count"], 3);
        // Everything under env is masked, even harmless-looking values.
        assert_eq!(m["env"]["DEBUG"], "••••");
        assert!(!s.contains("abcdefghijklmnop"), "leaked: {s}");
        assert!(!s.contains("plainvalue"), "leaked: {s}");
        assert_eq!(
            m["mcpServers"]["s"]["url"],
            "https://x.dev/mcp?token=••••&v=2"
        );
    }
}
