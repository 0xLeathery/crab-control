// Phase 3 creation flows: scaffold an agent/command/skill, and add an MCP server.
import { useEffect, useMemo, useState } from "react";
import { McpAddSpec, Scope, api } from "./api";
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

export function AddMcpModal({
  scope,
  onAdded,
  onClose,
}: {
  scope: Scope;
  onAdded: (msg: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [target, setTarget] = useState("");
  const [srvScope, setSrvScope] = useState<"local" | "user" | "project">(
    scope.kind === "project" ? "project" : "user"
  );
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
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
      args: isHttp ? [] : argsText.split(/\s+/).filter(Boolean),
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

  const ready = !!spec.name && !!spec.target;

  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Add MCP server</strong>
          <span className="muted mono" style={{ fontSize: 11 }}>
            claude mcp add
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
                <span>Args (space-separated)</span>
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
          <div className="fhint">Command preview (secrets masked)</div>
          <pre className="preview" style={{ maxHeight: 110 }}>
            {previewCmd || "—"}
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
          <button className="btn primary" onClick={add} disabled={busy || !ready}>
            {busy ? "Adding…" : "Add server"}
          </button>
        </div>
      </div>
    </div>
  );
}
