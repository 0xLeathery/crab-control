// Phase 3 creation flows: scaffold an agent/command/skill, and add an MCP server.
import { useEffect, useMemo, useState } from "react";
import { McpAddSpec, McpEditPreview, Scope, api } from "./api";
import { ConfirmModal, DiffModal } from "./editor";
import { joinArgs, splitArgs } from "./helpers";
import { Icon } from "./ui";

/* ---------- New agent / command / skill ---------- */

function template(kind: string, name: string, description: string, body: string): string {
  const desc = description.trim();
  const b = body.trim();
  if (kind === "command") {
    return `---\ndescription: ${desc}\n---\n\n${b || `# ${name}\n\nDescribe what this command does.`}\n`;
  }
  if (kind === "agent") {
    return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${
      b || `You are the ${name} agent. Describe the agent's role and instructions here.`
    }\n`;
  }
  // skill
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n${
    b || "Describe when this skill should trigger and what it does."
  }\n`;
}

export function NewItemModal({
  scope,
  kind,
  onCreated,
  onClose,
}: {
  scope: Scope;
  kind: "agent" | "command" | "skill";
  onCreated: (path: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const content = useMemo(
    () => template(kind, name || `my-${kind}`, description, body),
    [kind, name, description, body]
  );
  const nameOk = /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".");

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createItem(scope, kind, name, content);
      onCreated(r.displayPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const where = scope.kind === "project" ? "project" : "user";

  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>New {kind}</strong>
          <span className="muted" style={{ fontSize: 11.5 }}>
            creates a file in the {where} scope
          </span>
        </div>
        <div className="form">
          <label className="fld">
            <span>Name</span>
            <input
              className="finput mono"
              value={name}
              autoFocus
              placeholder={`my-${kind}`}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {!nameOk && name.length > 0 && (
            <div className="fhint err">letters, numbers, '.', '-', '_' only</div>
          )}
          <label className="fld">
            <span>Description</span>
            <input
              className="finput"
              value={description}
              placeholder="One line describing it"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="fld">
            <span>Body</span>
            <textarea
              className="code-area"
              rows={6}
              value={body}
              placeholder="Optional — leave blank for a starter template"
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="fhint">Preview</div>
          <pre className="preview" style={{ maxHeight: 180 }}>
            {content}
          </pre>
        </div>
        {error && (
          <div className="warnbar" style={{ margin: "0 16px 10px" }}>
            <Icon name="dot" size={12} /> {error}
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={busy || !nameOk}>
            {busy ? "Creating…" : `Create ${kind}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Add MCP server ---------- */

function splitLines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** An existing server being edited: its current name, CLI scope flag and masked spec. */
export interface McpEditTarget {
  name: string;
  flag: string;
  spec: McpAddSpec;
}

export function AddMcpModal({
  scope,
  edit,
  onAdded,
  onClose,
}: {
  scope: Scope;
  edit?: McpEditTarget;
  onAdded: (msg: string) => void;
  onClose: () => void;
}) {
  const init = edit?.spec;
  const [name, setName] = useState(init?.name ?? "");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">(init?.transport ?? "stdio");
  const [target, setTarget] = useState(init?.target ?? "");
  const [srvScope, setSrvScope] = useState<"local" | "user" | "project">(
    init?.scope ?? (scope.kind === "project" ? "project" : "user")
  );
  const [argsText, setArgsText] = useState(joinArgs(init?.args ?? []));
  const [envText, setEnvText] = useState((init?.env ?? []).join("\n"));
  const [headersText, setHeadersText] = useState((init?.headers ?? []).join("\n"));
  const [pending, setPending] = useState<McpEditPreview | null>(null);
  const [previewCmd, setPreviewCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHttp = transport === "http" || transport === "sse";

  const spec: McpAddSpec = useMemo(
    () => ({
      name: name.trim(),
      transport,
      target: target.trim(),
      scope: srvScope,
      args: isHttp ? [] : splitArgs(argsText),
      env: isHttp ? [] : splitLines(envText),
      headers: isHttp ? splitLines(headersText) : [],
    }),
    [name, transport, target, srvScope, argsText, envText, headersText, isHttp]
  );

  // Live masked preview of the CLI command.
  useEffect(() => {
    let cancelled = false;
    if (!spec.name || !spec.target) {
      setPreviewCmd("");
      return;
    }
    api.mcpAddPreview(spec).then((s) => {
      if (!cancelled) setPreviewCmd(s);
    });
    return () => {
      cancelled = true;
    };
  }, [spec]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.mcpAdd(spec);
      onAdded(out || `Added ${spec.name}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const review = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      setPending(await api.mcpPreviewUpdate(scope, edit.name, edit.flag, spec));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      onAdded(await api.mcpCommitUpdate(scope, edit.name, edit.flag, spec));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = !!spec.name && !!spec.target;

  if (edit && pending?.mode === "file") {
    return (
      <DiffModal
        subtitle={`Edit ${edit.name} in .mcp.json (secrets masked)`}
        path={pending.displayPath}
        oldText={pending.oldText}
        newText={pending.newText}
        busy={busy}
        error={error}
        onConfirm={commit}
        onCancel={() => setPending(null)}
      />
    );
  }
  if (edit && pending?.mode === "cli") {
    return (
      <ConfirmModal
        title={`Update ${edit.name}`}
        confirmLabel="Run commands"
        busy={busy}
        error={error}
        onConfirm={commit}
        onCancel={() => setPending(null)}
        body={
          <>
            The <span className="mono">claude</span> CLI owns {edit.flag} servers, so this
            removes the server and adds it back with your changes. If the add fails, the
            original is re-added automatically.
            <pre className="preview" style={{ marginTop: 8 }}>
              {pending.command}
            </pre>
          </>
        }
      />
    );
  }

  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{edit ? `Edit ${edit.name}` : "Add MCP server"}</strong>
          <span className="muted mono" style={{ fontSize: 11 }}>
            {edit ? (edit.flag === "project" ? ".mcp.json" : "claude mcp") : "claude mcp add"}
          </span>
        </div>
        <div className="form">
          <div className="frow">
            <label className="fld">
              <span>Name</span>
              <input
                className="finput mono"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="fld" style={{ maxWidth: 130 }}>
              <span>Transport</span>
              <select
                className="select"
                value={transport}
                onChange={(e) => setTransport(e.target.value as any)}
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
            </label>
            <label className="fld" style={{ maxWidth: 130 }}>
              <span>Scope</span>
              <select
                className="select"
                value={srvScope}
                disabled={!!edit}
                onChange={(e) => setSrvScope(e.target.value as any)}
              >
                <option value="user">user</option>
                <option value="project">project</option>
                <option value="local">local</option>
              </select>
            </label>
          </div>
          <label className="fld">
            <span>{isHttp ? "URL" : "Command"}</span>
            <input
              className="finput mono"
              value={target}
              placeholder={isHttp ? "https://host/mcp" : "npx"}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          {!isHttp && (
            <>
              <label className="fld">
                <span>Args (space-separated; quote args with spaces)</span>
                <input
                  className="finput mono"
                  value={argsText}
                  placeholder="my-mcp-server --flag"
                  onChange={(e) => setArgsText(e.target.value)}
                />
              </label>
              <label className="fld">
                <span>Env (one KEY=VALUE per line)</span>
                <textarea
                  className="code-area"
                  rows={2}
                  value={envText}
                  placeholder="API_KEY=..."
                  onChange={(e) => setEnvText(e.target.value)}
                />
              </label>
            </>
          )}
          {isHttp && (
            <label className="fld">
              <span>Headers (one per line)</span>
              <textarea
                className="code-area"
                rows={2}
                value={headersText}
                placeholder="Authorization: Bearer ..."
                onChange={(e) => setHeadersText(e.target.value)}
              />
            </label>
          )}
          {edit ? (
            <div className="fhint">
              Values shown as •••• are kept as they are unless you retype them.
            </div>
          ) : (
            <>
              <div className="fhint">Command preview (secrets masked)</div>
              <pre className="preview" style={{ maxHeight: 110 }}>
                {previewCmd || "—"}
              </pre>
            </>
          )}
        </div>
        {error && (
          <div className="warnbar" style={{ margin: "0 16px 10px" }}>
            <Icon name="dot" size={12} /> {error}
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {edit ? (
            <button className="btn primary" onClick={review} disabled={busy || !ready}>
              Review changes…
            </button>
          ) : (
            <button className="btn primary" onClick={add} disabled={busy || !ready}>
              {busy ? "Adding…" : "Add server"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
