//! Install, uninstall and update plugins, and add, remove and refresh
//! marketplaces, through `claude plugin`. The UI shows the exact command and
//! a trust warning first. Project/local scope commands run in the project
//! directory, since that's where the CLI writes their settings.

use std::path::PathBuf;

use serde::Deserialize;

use crate::model::Scope;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAction {
    /// install | uninstall | update | marketplace-add | marketplace-remove | marketplace-update
    pub action: String,
    /// A plugin (`name` or `name@marketplace`), a marketplace name, or for
    /// marketplace-add a source. Empty only for "update every marketplace".
    pub target: String,
    pub scope: Option<String>,
}

/// The argv after `claude`, validated so nothing the user typed can be read
/// as a flag.
pub fn plugin_argv(a: &PluginAction) -> Result<Vec<String>, String> {
    let sv = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let mut argv = match a.action.as_str() {
        "install" | "uninstall" => {
            let scope = scope(&a.scope, SETTINGS_SCOPES)?.unwrap_or("user");
            sv(&[
                "plugin",
                &a.action,
                plain("plugin", &a.target)?,
                "--scope",
                scope,
            ])
        }
        "update" => {
            let mut v = sv(&["plugin", "update", plain("plugin", &a.target)?]);
            if let Some(s) = scope(&a.scope, &["user", "project", "local", "managed"])? {
                v.extend(sv(&["--scope", s]));
            }
            v
        }
        "marketplace-add" => {
            let scope = scope(&a.scope, SETTINGS_SCOPES)?.unwrap_or("user");
            let source = plain("marketplace source", &a.target)?;
            sv(&["plugin", "marketplace", "add", source, "--scope", scope])
        }
        "marketplace-remove" => {
            let mut v = sv(&[
                "plugin",
                "marketplace",
                "remove",
                plain("marketplace", &a.target)?,
            ]);
            if let Some(s) = scope(&a.scope, SETTINGS_SCOPES)? {
                v.extend(sv(&["--scope", s]));
            }
            v
        }
        "marketplace-update" => sv(&["plugin", "marketplace", "update"]),
        other => return Err(format!("unknown plugin action: {other}")),
    };
    if a.action == "marketplace-update" && !a.target.trim().is_empty() {
        argv.push(plain("marketplace", &a.target)?.to_string());
    }
    Ok(argv)
}

/// Where to run the command. In a project scope always the project, since the
/// CLI reads project/local settings from its working directory.
pub fn working_dir(scope: &Scope, a: &PluginAction) -> Result<Option<PathBuf>, String> {
    crate::mcp::cli_cwd(scope, a.scope.as_deref())
}

/// The command as the confirm dialog shows it, credentials masked.
pub fn display(a: &PluginAction) -> Result<String, String> {
    let argv = plugin_argv(a)?;
    Ok(crate::secrets::mask_command(&format!(
        "claude {}",
        argv.join(" ")
    )))
}

/// Run the action and return the CLI's (masked) output.
pub fn run(scope: &Scope, a: &PluginAction) -> Result<String, String> {
    let argv = plugin_argv(a)?;
    let cwd = working_dir(scope, a)?;
    let refs: Vec<&str> = argv.iter().map(String::as_str).collect();
    let (ok, out) = crate::mcp::claude_run_in(&refs, cwd.as_deref())?;
    crate::mcp::cli_result(
        ok,
        &crate::secrets::mask_command(&out),
        "Done.",
        &format!("claude plugin {} failed", a.action.replace('-', " ")),
    )
}

const SETTINGS_SCOPES: &[&str] = &["user", "project", "local"];

/// One CLI argument: no leading `-` (it would be read as a flag), no spaces.
fn plain<'a>(what: &str, value: &'a str) -> Result<&'a str, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(format!("{what} is required"));
    }
    if v.starts_with('-') {
        return Err(format!("{what} can't start with '-'"));
    }
    if v.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("{what} can't contain spaces"));
    }
    Ok(v)
}

fn scope<'a>(s: &'a Option<String>, allowed: &[&str]) -> Result<Option<&'a str>, String> {
    match s.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(v) if allowed.contains(&v) => Ok(Some(v)),
        Some(v) => Err(format!("unsupported scope: {v}")),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ScopeKind;

    fn act(action: &str, target: &str, scope: Option<&str>) -> PluginAction {
        PluginAction {
            action: action.into(),
            target: target.into(),
            scope: scope.map(String::from),
        }
    }

    fn argv(action: &str, target: &str, scope: Option<&str>) -> String {
        plugin_argv(&act(action, target, scope)).unwrap().join(" ")
    }

    #[test]
    fn builds_plugin_commands() {
        assert_eq!(
            argv("install", "fmt@market", Some("project")),
            "plugin install fmt@market --scope project"
        );
        assert_eq!(
            argv("install", "fmt", None),
            "plugin install fmt --scope user"
        );
        assert_eq!(
            argv("uninstall", "fmt@market", Some("local")),
            "plugin uninstall fmt@market --scope local"
        );
        assert_eq!(
            argv("update", "fmt@market", None),
            "plugin update fmt@market"
        );
        assert_eq!(
            argv("update", "fmt@market", Some("user")),
            "plugin update fmt@market --scope user"
        );
    }

    #[test]
    fn builds_marketplace_commands() {
        assert_eq!(
            argv("marketplace-add", "org/repo#v1", Some("project")),
            "plugin marketplace add org/repo#v1 --scope project"
        );
        assert_eq!(
            argv("marketplace-add", "https://example.com/mp.json", None),
            "plugin marketplace add https://example.com/mp.json --scope user"
        );
        assert_eq!(
            argv("marketplace-remove", "mp", None),
            "plugin marketplace remove mp"
        );
        assert_eq!(
            argv("marketplace-update", "mp", None),
            "plugin marketplace update mp"
        );
        assert_eq!(
            argv("marketplace-update", "", None),
            "plugin marketplace update"
        );
    }

    #[test]
    fn project_scopes_run_in_the_project() {
        let global = Scope {
            kind: ScopeKind::Global,
            path: None,
        };
        let proj = Scope {
            kind: ScopeKind::Project,
            path: Some("/work/app".into()),
        };
        let p = |s: &Scope, a: &str, sc: Option<&str>| working_dir(s, &act(a, "x", sc));
        assert_eq!(
            p(&proj, "install", Some("project")),
            Ok(Some("/work/app".into()))
        );
        // The CLI auto-detects scope from the cwd, so project scope always runs there.
        assert_eq!(p(&proj, "update", None), Ok(Some("/work/app".into())));
        assert_eq!(p(&global, "install", Some("user")), Ok(None));
        assert!(p(&global, "install", Some("local")).is_err());
        assert!(p(&global, "uninstall", Some("project")).is_err());
    }

    #[test]
    fn display_masks_credentials() {
        let a = act(
            "marketplace-add",
            "https://user:hunter2pass@git.example.com/mp.git",
            None,
        );
        let d = display(&a).unwrap();
        assert!(d.starts_with("claude plugin marketplace add "), "{d}");
        assert!(!d.contains("hunter2pass"), "{d}");
    }

    #[test]
    fn refuses_flags_bad_names_and_scopes() {
        for (a, t, s) in [
            ("install", "--dangerous", None),
            ("install", "", None),
            ("install", "fmt market", None),
            ("install", "fmt", Some("managed")),
            ("uninstall", "-y", None),
            ("marketplace-add", "-x", None),
            ("marketplace-add", "", None),
            ("marketplace-remove", "", None),
            ("marketplace-update", "--all", None),
            ("explode", "x", None),
        ] {
            assert!(plugin_argv(&act(a, t, s)).is_err(), "{a} {t:?} {s:?}");
        }
        // Update also accepts managed scope, per the CLI reference.
        assert!(plugin_argv(&act("update", "fmt", Some("managed"))).is_ok());
    }
}
