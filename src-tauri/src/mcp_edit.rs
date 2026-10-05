//! Editing existing MCP servers. Project servers live in `.mcp.json`, which we
//! edit through the writer; user/local servers are owned by the `claude` CLI,
//! so an edit there is `mcp remove` + `mcp add`, rolled back if the add fails.
//!
//! The UI only ever sees a masked spec. Masked values it sends back unchanged
//! are swapped for the originals here; any other masked value is refused.

use serde_json::{Map, Value};

use crate::creator::{mcp_add_argv, mcp_add_display, McpAddSpec};
use std::path::PathBuf;

use crate::model::{Scope, ScopeKind};
use crate::secrets::mask_value;
use crate::secrets::{is_secret_key, mask_command, mask_url, MASK_CHAR};
use crate::util::{home, read_json, tildify};
use crate::writer;

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn pairs(v: Option<&Value>, sep: &str) -> Vec<String> {
    v.and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(k, v)| format!("{k}{sep}{}", v.as_str().unwrap_or_default()))
                .collect()
        })
        .unwrap_or_default()
}

/// Turn a server definition from a config file into a form spec.
pub fn spec_from_def(name: &str, def: &Value) -> Result<McpAddSpec, String> {
    let typ = def.get("type").and_then(Value::as_str);
    let mut spec = McpAddSpec {
        name: name.to_string(),
        ..Default::default()
    };
    if let Some(url) = def.get("url").and_then(Value::as_str) {
        spec.transport = match typ {
            Some("sse") => "sse",
            _ => "http",
        }
        .into();
        spec.target = url.to_string();
        spec.headers = pairs(def.get("headers"), ": ");
    } else if let Some(cmd) = def.get("command").and_then(Value::as_str) {
        spec.transport = "stdio".into();
        spec.target = cmd.to_string();
        spec.args = strings(def.get("args"));
        spec.env = pairs(def.get("env"), "=");
    } else {
        return Err(format!("{name} has neither a command nor a url"));
    }
    Ok(spec)
}

/// Literal values are masked; `${VAR}` expansions carry no secret and stay.
fn mask_pair(entry: &str, sep: &str) -> String {
    match entry.split_once(sep) {
        Some((k, v)) if !v.trim().is_empty() && !v.contains("${") => format!("{k}{sep}••••"),
        _ => entry.to_string(),
    }
}

/// Mask what can carry secrets: env and header values, URL credentials and
/// secret-looking args.
pub fn mask_spec(spec: &McpAddSpec) -> McpAddSpec {
    let mut mask_next = false;
    let args = spec
        .args
        .iter()
        .map(|a| {
            let masked = if mask_next && !a.starts_with('-') {
                "••••".to_string()
            } else {
                mask_command(a)
            };
            mask_next =
                a.starts_with('-') && !a.contains('=') && is_secret_key(a.trim_start_matches('-'));
            masked
        })
        .collect();
    McpAddSpec {
        target: if spec.target.starts_with("http") {
            mask_url(&spec.target)
        } else {
            mask_command(&spec.target)
        },
        args,
        env: spec.env.iter().map(|e| mask_pair(e, "=")).collect(),
        headers: spec.headers.iter().map(|h| mask_pair(h, ": ")).collect(),
        ..spec.clone()
    }
}

fn masked_err(what: &str) -> String {
    format!(
        "{what} contains a masked value (••••) that no longer matches the original; \
         retype the full value"
    )
}

/// Positional restore (target, args).
fn restore_at(
    what: &str,
    new: &str,
    masked: Option<&String>,
    orig: Option<&String>,
) -> Result<String, String> {
    if !new.contains(MASK_CHAR) {
        return Ok(new.to_string());
    }
    match (masked, orig) {
        (Some(m), Some(o)) if m == new => Ok(o.clone()),
        _ => Err(masked_err(what)),
    }
}

/// Restore by matching the whole masked entry (env, headers), which carries
/// its key, so reordering is fine.
fn restore_list(
    what: &str,
    new: &[String],
    masked: &[String],
    orig: &[String],
) -> Result<Vec<String>, String> {
    new.iter()
        .map(|n| {
            if !n.contains(MASK_CHAR) {
                return Ok(n.clone());
            }
            masked
                .iter()
                .position(|m| m == n)
                .and_then(|i| orig.get(i).cloned())
                .ok_or_else(|| masked_err(what))
        })
        .collect()
}

/// Replace masked values the user left untouched with the originals.
pub fn unmask_spec(new: &McpAddSpec, original: &McpAddSpec) -> Result<McpAddSpec, String> {
    let m = mask_spec(original);
    let args = new
        .args
        .iter()
        .enumerate()
        .map(|(i, a)| restore_at("an argument", a, m.args.get(i), original.args.get(i)))
        .collect::<Result<_, _>>()?;
    Ok(McpAddSpec {
        target: restore_at(
            "the command/URL",
            &new.target,
            Some(&m.target),
            Some(&original.target),
        )?,
        args,
        env: restore_list("an env entry", &new.env, &m.env, &original.env)?,
        headers: restore_list("a header", &new.headers, &m.headers, &original.headers)?,
        ..new.clone()
    })
}

pub fn validate_spec(spec: &McpAddSpec) -> Result<(), String> {
    let name = spec.name.trim();
    if name.is_empty() || name.chars().any(char::is_whitespace) {
        return Err("name is required and cannot contain spaces".into());
    }
    if spec.target.trim().is_empty() {
        return Err("command/URL is required".into());
    }
    match spec.transport.as_str() {
        "stdio" => Ok(()),
        "http" | "sse"
            if spec.target.starts_with("http://") || spec.target.starts_with("https://") =>
        {
            Ok(())
        }
        "http" | "sse" => Err("URL must start with http:// or https://".into()),
        t => Err(format!("unknown transport: {t}")),
    }
}

fn to_map(entries: &[String], sep: char) -> Result<Map<String, Value>, String> {
    entries
        .iter()
        .map(|e| {
            let (k, v) = e
                .split_once(sep)
                .ok_or_else(|| format!("\"{e}\" should look like KEY{sep}value"))?;
            Ok((k.trim().to_string(), Value::String(v.trim().to_string())))
        })
        .collect()
}

/// Set (or drop, when empty) a key without moving it.
fn put(obj: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    match value {
        Some(v) => {
            obj.insert(key.into(), v);
        }
        None => {
            obj.shift_remove(key);
        }
    }
}

/// Write the spec's fields into an existing definition, keeping keys the form
/// doesn't own (e.g. `timeout`) and their order.
fn write_def(obj: &mut Map<String, Value>, spec: &McpAddSpec) -> Result<(), String> {
    let nonempty = |m: Map<String, Value>| (!m.is_empty()).then_some(Value::Object(m));
    if spec.transport == "stdio" {
        if obj.contains_key("type") {
            obj.insert("type".into(), "stdio".into());
        }
        obj.insert("command".into(), spec.target.trim().into());
        let args = (!spec.args.is_empty()).then(|| Value::from(spec.args.clone()));
        put(obj, "args", args);
        put(obj, "env", nonempty(to_map(&spec.env, '=')?));
        put(obj, "url", None);
        put(obj, "headers", None);
    } else {
        obj.insert("type".into(), spec.transport.clone().into());
        obj.insert("url".into(), spec.target.trim().into());
        put(obj, "headers", nonempty(to_map(&spec.headers, ':')?));
        for k in ["command", "args", "env"] {
            put(obj, k, None);
        }
    }
    Ok(())
}

/// Apply an edit of `old_name` in a parsed `.mcp.json`.
pub fn apply_mcp_json_update(
    v: &mut Value,
    old_name: &str,
    spec: &McpAddSpec,
) -> Result<(), String> {
    validate_spec(spec)?;
    if crate::secrets::contains_mask(&serde_json::to_value(spec).unwrap_or_default()) {
        return Err(masked_err("the server"));
    }
    let servers = v
        .get_mut("mcpServers")
        .and_then(Value::as_object_mut)
        .ok_or("no mcpServers in .mcp.json")?;
    let new_name = spec.name.trim();
    if !servers.contains_key(old_name) {
        return Err(format!("{old_name} not found in .mcp.json"));
    }
    if new_name != old_name && servers.contains_key(new_name) {
        return Err(format!("a server named {new_name} already exists"));
    }
    let def = servers.get_mut(old_name).expect("checked above");
    if !def.is_object() {
        *def = Value::Object(Map::new());
    }
    write_def(def.as_object_mut().expect("object"), spec)?;
    if new_name != old_name {
        let old = std::mem::take(servers);
        for (k, d) in old {
            let k = if k == old_name {
                new_name.to_string()
            } else {
                k
            };
            servers.insert(k, d);
        }
    }
    Ok(())
}

/// The runner for `claude <args>`, returning (success, output).
pub type Runner<'a> = dyn FnMut(&[String]) -> Result<(bool, String), String> + 'a;

/// The confirm-dialog text for a CLI edit: the exact commands, masked.
pub fn cli_update_display(old_name: &str, original: &McpAddSpec, new: &McpAddSpec) -> String {
    let new = McpAddSpec {
        scope: original.scope.clone(),
        ..new.clone()
    };
    format!(
        "claude mcp remove {old_name} -s {}\n{}",
        original.scope,
        mcp_add_display(&new)
    )
}

/// Edit a user/local server: remove it, add the new definition, and re-add the
/// original if that fails.
pub fn update_via_cli(
    run: &mut Runner,
    old_name: &str,
    original: &McpAddSpec,
    new: &McpAddSpec,
) -> Result<String, String> {
    validate_spec(new)?;
    let new = McpAddSpec {
        scope: original.scope.clone(),
        ..new.clone()
    };
    let remove: Vec<String> = ["mcp", "remove", old_name, "-s", &original.scope]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let (ok, out) = run(&remove)?;
    if !ok {
        return Err(format!("claude mcp remove failed: {}", mask_command(&out)));
    }
    let (ok, out) = run(&mcp_add_argv(&new))?;
    if ok {
        return Ok(format!("Updated {}.", new.name));
    }
    let out = mask_command(&out);
    match run(&mcp_add_argv(original)) {
        Ok((true, _)) => Err(format!(
            "claude mcp add failed: {out}. The original server was restored."
        )),
        Ok((false, r)) | Err(r) => Err(format!(
            "claude mcp add failed: {out}. Restoring the original also failed ({}); \
             re-add it with: {}",
            mask_command(&r),
            mcp_add_display(original)
        )),
    }
}

/// What the UI shows before an edit: a masked diff of `.mcp.json`, or the
/// masked CLI commands for user/local servers.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEditPreview {
    pub mode: String,
    pub display_path: String,
    pub old_text: String,
    pub new_text: String,
    pub command: String,
}

/// Where a server's definition lives for a `claude mcp` scope flag: the file
/// and the key path to its `mcpServers` object.
fn location(scope: &Scope, flag: &str) -> Result<(PathBuf, Vec<String>), String> {
    let project = match scope {
        Scope {
            kind: ScopeKind::Project,
            path: Some(p),
        } => Some(p.clone()),
        _ => None,
    };
    let servers = "mcpServers".to_string();
    match (flag, project) {
        ("project", Some(p)) => Ok((PathBuf::from(p).join(".mcp.json"), vec![servers])),
        ("user", _) => Ok((home().join(".claude.json"), vec![servers])),
        ("local", Some(p)) => Ok((
            home().join(".claude.json"),
            vec!["projects".into(), p, servers],
        )),
        ("claudeai", _) => Err("claude.ai servers are managed in claude.ai".into()),
        _ => Err(format!("can't edit {flag} servers from this scope")),
    }
}

fn original_spec(scope: &Scope, name: &str, flag: &str) -> Result<McpAddSpec, String> {
    let (path, keys) = location(scope, flag)?;
    let v = read_json(&path)?.ok_or_else(|| format!("{} not found", tildify(&path)))?;
    let def = keys
        .iter()
        .try_fold(&v, |v, k| v.get(k))
        .and_then(|m| m.get(name))
        .ok_or_else(|| format!("{name} not found in {}", tildify(&path)))?;
    Ok(McpAddSpec {
        scope: flag.to_string(),
        ..spec_from_def(name, def)?
    })
}

/// The masked spec the edit form starts from.
pub fn read_spec(scope: &Scope, name: &str, flag: &str) -> Result<McpAddSpec, String> {
    Ok(mask_spec(&original_spec(scope, name, flag)?))
}

fn pretty(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap_or_default();
    s.push('\n');
    s
}

/// `.mcp.json` before and after the edit, with real values.
fn project_change(
    scope: &Scope,
    name: &str,
    spec: &McpAddSpec,
) -> Result<(PathBuf, Value, Value), String> {
    let original = original_spec(scope, name, "project")?;
    let spec = unmask_spec(spec, &original)?;
    let (path, _) = location(scope, "project")?;
    let old = read_json(&path)?.unwrap_or_default();
    let mut new = old.clone();
    apply_mcp_json_update(&mut new, name, &spec)?;
    Ok((path, old, new))
}

pub fn preview_update(
    scope: &Scope,
    name: &str,
    flag: &str,
    spec: &McpAddSpec,
) -> Result<McpEditPreview, String> {
    if flag == "project" {
        let (path, old, new) = project_change(scope, name, spec)?;
        return Ok(McpEditPreview {
            mode: "file".into(),
            display_path: tildify(&path),
            old_text: pretty(&mask_value(&old, None)),
            new_text: pretty(&mask_value(&new, None)),
            command: String::new(),
        });
    }
    let original = original_spec(scope, name, flag)?;
    let new = unmask_spec(spec, &original)?;
    validate_spec(&new)?;
    Ok(McpEditPreview {
        mode: "cli".into(),
        display_path: String::new(),
        old_text: String::new(),
        new_text: String::new(),
        command: cli_update_display(name, &original, &new),
    })
}

/// Apply the edit. The change is recomputed here from the spec rather than
/// taken from the UI, so masked text can never be written.
pub fn commit_update(
    scope: &Scope,
    name: &str,
    flag: &str,
    spec: &McpAddSpec,
) -> Result<String, String> {
    if flag == "project" {
        let (path, _, new) = project_change(scope, name, spec)?;
        let r = writer::save_to_path(&path, false, &pretty(&new));
        return match r.error {
            None if r.ok => Ok(format!("Saved {}.", tildify(&path))),
            e => Err(e.unwrap_or_else(|| "save failed".into())),
        };
    }
    let original = original_spec(scope, name, flag)?;
    let new = unmask_spec(spec, &original)?;
    let cwd = crate::mcp::cli_cwd(scope, Some(flag))?;
    let mut run = |args: &[String]| {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        crate::mcp::claude_run_in(&refs, cwd.as_deref())
    };
    update_via_cli(&mut run, name, &original, &new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    fn stdio() -> McpAddSpec {
        McpAddSpec {
            name: "gh".into(),
            transport: "stdio".into(),
            target: "npx".into(),
            scope: "user".into(),
            args: s(&["-y", "gh-mcp", "--token", "abc123plain"]),
            env: s(&["GITHUB_TOKEN=ghp_secretvalue123456", "MODE=${MODE}"]),
            headers: vec![],
        }
    }

    #[test]
    fn spec_from_def_reads_stdio_and_http() {
        let st = spec_from_def(
            "gh",
            &json!({"command":"npx","args":["-y","gh-mcp"],"env":{"A":"1"}}),
        )
        .unwrap();
        assert_eq!(
            (
                st.transport.as_str(),
                st.target.as_str(),
                st.args.clone(),
                st.env.clone()
            ),
            ("stdio", "npx", s(&["-y", "gh-mcp"]), s(&["A=1"]))
        );
        let h = spec_from_def(
            "api",
            &json!({"type":"sse","url":"https://x.dev/sse","headers":{"Authorization":"Bearer t"}}),
        )
        .unwrap();
        assert_eq!(
            (h.transport.as_str(), h.target.as_str(), h.headers.clone()),
            ("sse", "https://x.dev/sse", s(&["Authorization: Bearer t"]))
        );
        assert!(spec_from_def("x", &json!({"foo": 1})).is_err());
    }

    #[test]
    fn mask_spec_hides_secrets_but_keeps_expansions() {
        let m = mask_spec(&stdio());
        assert_eq!(m.args, s(&["-y", "gh-mcp", "--token", "••••"]));
        assert_eq!(m.env, s(&["GITHUB_TOKEN=••••", "MODE=${MODE}"]));
        let h = McpAddSpec {
            transport: "http".into(),
            target: "https://x.dev/mcp?key=sk_live_abcdefgh12345678".into(),
            headers: s(&["Authorization: Bearer xyz", "X-Org: ${ORG}"]),
            ..Default::default()
        };
        let mh = mask_spec(&h);
        assert!(!mh.target.contains("abcdefgh"), "{}", mh.target);
        assert_eq!(mh.headers, s(&["Authorization: ••••", "X-Org: ${ORG}"]));
    }

    #[test]
    fn unmask_restores_untouched_values_and_refuses_others() {
        let orig = stdio();
        let mut edited = mask_spec(&orig);
        edited.args.push("--verbose".into());
        edited.env.push("NEW=1".into());
        let got = unmask_spec(&edited, &orig).unwrap();
        assert_eq!(
            got.args,
            s(&["-y", "gh-mcp", "--token", "abc123plain", "--verbose"])
        );
        assert_eq!(
            got.env,
            s(&[
                "GITHUB_TOKEN=ghp_secretvalue123456",
                "MODE=${MODE}",
                "NEW=1"
            ])
        );

        let mut bad = mask_spec(&orig);
        bad.env[0] = "OTHER=••••".into();
        assert!(unmask_spec(&bad, &orig).is_err());
        let mut bad = mask_spec(&orig);
        bad.args.remove(0); // the masked arg shifted position
        assert!(unmask_spec(&bad, &orig).is_err());
    }

    #[test]
    fn mcp_json_update_edits_in_place_and_renames() {
        let mut v = json!({"mcpServers":{
            "a":{"type":"stdio","command":"old","args":["x"],"timeout":5},
            "b":{"type":"http","url":"https://b.dev"}}});
        let spec = McpAddSpec {
            name: "a".into(),
            transport: "stdio".into(),
            target: "new".into(),
            env: s(&["K=${K}"]),
            ..Default::default()
        };
        apply_mcp_json_update(&mut v, "a", &spec).unwrap();
        assert_eq!(
            v["mcpServers"]["a"].to_string(),
            r#"{"type":"stdio","command":"new","timeout":5,"env":{"K":"${K}"}}"#
        );
        // Rename keeps position; switching to http drops stdio keys.
        let http = McpAddSpec {
            name: "a2".into(),
            transport: "http".into(),
            target: "https://a.dev".into(),
            ..Default::default()
        };
        apply_mcp_json_update(&mut v, "a", &http).unwrap();
        let keys: Vec<&String> = v["mcpServers"].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["a2", "b"]);
        assert_eq!(
            v["mcpServers"]["a2"],
            json!({"type":"http","url":"https://a.dev","timeout":5})
        );
        // Name clash and missing server are errors.
        let clash = McpAddSpec {
            name: "b".into(),
            ..http.clone()
        };
        assert!(apply_mcp_json_update(&mut v, "a2", &clash).is_err());
        assert!(apply_mcp_json_update(&mut v, "zzz", &http).is_err());
    }

    #[test]
    fn cli_update_rolls_back_when_add_fails() {
        let orig = stdio();
        let new = McpAddSpec {
            target: "bad".into(),
            ..orig.clone()
        };
        let mut calls: Vec<Vec<String>> = Vec::new();
        let mut run = |a: &[String]| {
            calls.push(a.to_vec());
            // The new definition fails; everything else works.
            Ok((!a.contains(&"bad".to_string()), "nope".to_string()))
        };
        let err = update_via_cli(&mut run, "gh", &orig, &new).unwrap_err();
        assert!(err.contains("restored"), "{err}");
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0], s(&["mcp", "remove", "gh", "-s", "user"]));
        assert!(
            calls[2].contains(&"abc123plain".to_string()),
            "re-adds the original"
        );

        let mut ok = |_: &[String]| Ok((true, String::new()));
        assert!(update_via_cli(&mut ok, "gh", &orig, &orig).is_ok());

        let mut remove_fails = |_: &[String]| Ok((false, "no such server".to_string()));
        let err = update_via_cli(&mut remove_fails, "gh", &orig, &orig).unwrap_err();
        assert!(err.contains("no such server"), "{err}");
    }

    #[test]
    fn project_edit_previews_masked_and_saves_real_values() {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let proj = std::env::temp_dir().join(format!("cc-mcp-edit-{ms}"));
        std::fs::create_dir_all(&proj).unwrap();
        let file = proj.join(".mcp.json");
        std::fs::write(
            &file,
            r#"{"mcpServers":{"gh":{"command":"old","env":{"GITHUB_TOKEN":"ghp_realsecret12345678"}}}}"#,
        )
        .unwrap();
        let scope = Scope {
            kind: ScopeKind::Project,
            path: Some(proj.display().to_string()),
        };
        let mut spec = read_spec(&scope, "gh", "project").unwrap();
        assert_eq!(spec.env, s(&["GITHUB_TOKEN=••••"]));
        spec.target = "new".into();

        let p = preview_update(&scope, "gh", "project", &spec).unwrap();
        assert_eq!(p.mode, "file");
        assert!(!p.old_text.contains("realsecret") && !p.new_text.contains("realsecret"));
        assert!(p.new_text.contains("\"new\""), "{}", p.new_text);

        commit_update(&scope, "gh", "project", &spec).unwrap();
        let saved = std::fs::read_to_string(&file).unwrap();
        assert!(
            saved.contains("\"new\"") && saved.contains("ghp_realsecret12345678"),
            "{saved}"
        );
        let backups = std::fs::read_dir(&proj)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".backup.")
            })
            .count();
        assert_eq!(backups, 1);
        std::fs::remove_dir_all(&proj).ok();
    }
}
