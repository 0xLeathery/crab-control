import { useState } from "react";
import { McpServer, MutationPreview, Scope, api } from "../api";
import { Empty, Icon } from "../ui";
import { ConfirmModal, PreviewConfirm } from "../editor";
import { AddMcpModal, McpEditTarget } from "../create";
import { isPluginServer, mcpScopeFlag, statusClass } from "../helpers";
import { Loading } from "./common";

/* ---------- MCP ---------- */



export function McpPanel({
  servers,
  busy,
  onReload,
  filter,
  scope,
}: {
  servers: McpServer[] | null;
  busy: boolean;
  onReload: () => void;
  filter: string;
  scope: Scope;
}) {
  const [removeTarget, setRemoveTarget] = useState<McpServer | null>(null);
  const [togglePreview, setTogglePreview] = useState<MutationPreview | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<McpEditTarget | null>(null);

  const startEdit = async (s: McpServer) => {
    setActionError(null);
    const flag = mcpScopeFlag(s);
    try {
      setEditing({ name: s.name, flag, spec: await api.mcpReadSpec(scope, s.name, flag) });
    } catch (e) {
      setActionError(String(e));
    }
  };

  const f = filter.trim().toLowerCase();
  const list = (servers ?? []).filter(
    (s) =>
      !f ||
      s.name.toLowerCase().includes(f) ||
      (s.target ?? "").toLowerCase().includes(f) ||
      s.scope.toLowerCase().includes(f)
  );

  const doRemove = async () => {
    if (!removeTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const out = await api.mcpRemove(removeTarget.name, mcpScopeFlag(removeTarget));
      setRemoveTarget(null);
      setNote(out || `Removed ${removeTarget.name}.`);
      onReload();
      setTimeout(() => setNote(null), 8000);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const startToggle = async (s: McpServer, enabled: boolean) => {
    setActionError(null);
    try {
      setTogglePreview(await api.previewMcpToggle(scope, s.name, enabled));
    } catch (e) {
      setActionError(String(e));
    }
  };

  return (
    <div className="panel">
      <h1>MCP Servers</h1>
      <div className="sub">
        Live state from the <span className="mono">claude</span> CLI, merged with
        file-defined servers. Tokens in URLs are masked.
      </div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="mcp" size={13} /> &nbsp;Add server
        </button>
        <button className="btn" onClick={onReload} disabled={busy}>
          {busy ? "Checking…" : "Reload"}
        </button>
        {busy && <span className="spin" />}
      </div>

      {note && (
        <div className="okbar">
          <Icon name="dot" size={12} /> {note}
        </div>
      )}
      {actionError && (
        <div className="warnbar">
          <Icon name="dot" size={12} /> {actionError}
        </div>
      )}

      {servers === null && busy ? (
        <Loading label="Querying claude mcp list…" />
      ) : list.length === 0 ? (
        <Empty>
          {servers === null
            ? "Could not query MCP servers."
            : f
            ? "No servers match the filter."
            : "No MCP servers configured."}
        </Empty>
      ) : (
        list.map((s) => {
          const isProjectMcp =
            s.scope.toLowerCase().includes("project") ||
            s.source.toLowerCase().includes(".mcp.json");
          const isClaudeAi = mcpScopeFlag(s) === "claudeai";
          const isPlugin = isPluginServer(s);
          return (
            <div className="row" key={s.name + s.source}>
              <div className="grow">
                <div className="nm">
                  {s.name}
                  <span className="badge accent">{s.transport}</span>
                  {s.scope && s.scope !== "unknown" && (
                    <span className="badge layer">{s.scope}</span>
                  )}
                </div>
                {s.target && <div className="path">{s.target}</div>}
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {s.source}
                </div>
              </div>
              {s.status && (
                <span className={`badge ${statusClass(s.status)}`}>{s.status}</span>
              )}
              {isProjectMcp && !isPlugin && (
                <>
                  <button className="btn" onClick={() => startToggle(s, true)}>
                    Enable
                  </button>
                  <button className="btn" onClick={() => startToggle(s, false)}>
                    Disable
                  </button>
                </>
              )}
              {isPlugin ? (
                <span className="badge muted" title="Provided by a plugin — manage it from Plugins">
                  plugin
                </span>
              ) : isClaudeAi ? (
                <span
                  className="badge muted"
                  title="Provided by your connected claude.ai account — remove it in claude.ai or via Claude Code's /mcp menu"
                >
                  claude.ai managed
                </span>
              ) : (
                <>
                  <button className="btn" onClick={() => startEdit(s)}>
                    Edit…
                  </button>
                  <button className="btn danger-outline" onClick={() => setRemoveTarget(s)}>
                    Remove
                  </button>
                </>
              )}
            </div>
          );
        })
      )}

      {removeTarget && (
        <ConfirmModal
          title="Remove MCP server"
          danger
          confirmLabel="Remove server"
          busy={actionBusy}
          error={actionError}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={doRemove}
          body={
            <>
              Remove <strong>{removeTarget.name}</strong> via{" "}
              <span className="mono">claude mcp remove</span> (scope{" "}
              <span className="mono">{mcpScopeFlag(removeTarget)}</span>)? This runs the
              CLI and cannot be undone from here.
            </>
          }
        />
      )}

      {togglePreview && (
        <PreviewConfirm
          scope={scope}
          preview={togglePreview}
          onCancel={() => setTogglePreview(null)}
          onDone={(backup) => {
            setTogglePreview(null);
            setNote(backup ? `Saved. Backup: ${backup}` : "Saved.");
            onReload();
            setTimeout(() => setNote(null), 6000);
          }}
        />
      )}

      {editing && (
        <AddMcpModal
          scope={scope}
          edit={editing}
          onClose={() => setEditing(null)}
          onAdded={(msg) => {
            setEditing(null);
            setNote(msg);
            onReload();
            setTimeout(() => setNote(null), 8000);
          }}
        />
      )}

      {adding && (
        <AddMcpModal
          scope={scope}
          onClose={() => setAdding(false)}
          onAdded={(msg) => {
            setAdding(false);
            setNote(msg);
            onReload();
            setTimeout(() => setNote(null), 8000);
          }}
        />
      )}
    </div>
  );
}
