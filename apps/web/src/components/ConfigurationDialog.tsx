import { useEffect, useMemo, useState } from "react";
import {
  createConfigurationToken,
  createConfigurationUser,
  connectGitHub,
  disconnectGitHub,
  fetchConfiguration,
  fetchConfigurationTokens,
  fetchHostPortSettings,
  fetchRegistry,
  formatApiError,
  saveHostPortSettings,
  revokeConfigurationToken,
  saveAuthenticationEnabled,
  saveGeneralConfiguration,
  saveRemoteConfiguration,
  type ConfigurationScope,
} from "../lib/registry.js";
import type {
  AccessTokenSummary,
  ConfigurationScopeType,
  ConfigurationState,
  PortSettings,
  Registry,
  RemoteAccessSettings,
  ThemePreference,
  TokenRole,
} from "../lib/types.js";
import { useAuth } from "../AuthContext.js";
import "./ConfigurationDialog.css";

type ConfigurationTab = "general" | "integrations" | "remote" | "ports" | "tokens" | "auth";

/** Remote access, ports, and authentication are Project Space concerns; a project only sees its own settings. */
const TABS: Array<{ id: ConfigurationTab; label: string; note: string; scopes: ConfigurationScopeType[] }> = [
  { id: "general", label: "General", note: "Appearance", scopes: ["project", "project_space", "host"] },
  { id: "integrations", label: "Integrations", note: "Connected services", scopes: ["project", "project_space", "host"] },
  { id: "remote", label: "Remote", note: "Port forwarding", scopes: ["project_space", "host"] },
  { id: "ports", label: "Ports", note: "Host machine", scopes: ["project_space", "host"] },
  { id: "tokens", label: "Access tokens", note: "Agent credentials", scopes: ["project", "project_space", "host"] },
  { id: "auth", label: "Authentication", note: "Users and access", scopes: ["project_space", "host"] },
];

const TOKEN_ROLE_HELP: Record<Exclude<TokenRole, "custom">, string> = {
  observer: "Read project state, runs, assets, and files.",
  contributor: "Observer access plus status, update, and asset writes.",
  operator: "Contributor access plus run control, file writes, configuration, audit, and token visibility.",
  administrator: "Every capability, including creating and revoking tokens.",
};

function applyTheme(theme: ThemePreference): void {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  localStorage.setItem("konductor-theme", theme);
}

function tokenState(token: AccessTokenSummary): "active" | "expired" | "revoked" {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) return "expired";
  return "active";
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function defaultRemote(): RemoteAccessSettings {
  return {
    enabled: false,
    transport: "ssh_reverse_tunnel",
    ssh_host: "",
    ssh_user: "",
    local_host: "127.0.0.1",
    local_port: 4096,
    remote_port: 4096,
  };
}

interface Props {
  open: boolean;
  scope: ConfigurationScope;
  initialTab?: ConfigurationTab;
  onClose: () => void;
}

export function ConfigurationDialog({ open, scope, initialTab = "general", onClose }: Props) {
  const tabs = useMemo(() => TABS.filter((item) => item.scopes.includes(scope.type)), [scope.type]);
  const [tab, setTab] = useState<ConfigurationTab>(initialTab);
  const [state, setState] = useState<ConfigurationState | null>(null);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [tokens, setTokens] = useState<AccessTokenSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const { refresh: refreshAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const [remote, setRemote] = useState<RemoteAccessSettings>(defaultRemote);
  const [tokenName, setTokenName] = useState("");
  const [tokenRole, setTokenRole] = useState<TokenRole>("contributor");
  const [tokenProjects, setTokenProjects] = useState<string[]>(scope.projectIds);
  const [tokenLifetime, setTokenLifetime] = useState("30");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<"admin" | "member">("member");
  const [githubToken, setGithubToken] = useState("");
  // Port reservations belong to the machine, not the scope, so they load and save separately.
  const [ports, setPorts] = useState<PortSettings | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(tabs.some((item) => item.id === initialTab) ? initialTab : "general");
    setError(null);
    setMessage(null);
    setIssuedToken(null);
    setTokenProjects(scope.projectIds);
    let cancelled = false;
    void Promise.all([
      fetchConfiguration(scope),
      fetchRegistry(),
      fetchConfigurationTokens(scope),
      fetchHostPortSettings(),
    ]).then(([nextState, nextRegistry, nextTokens, nextPorts]) => {
      if (cancelled) return;
      setState(nextState);
      setRemote(nextState.settings.remote);
      setRegistry(nextRegistry);
      setTokens(nextTokens);
      setPorts(nextPorts);
    }).catch((nextError: unknown) => {
      if (!cancelled) setError(formatApiError(nextError));
    });
    return () => { cancelled = true; };
  }, [open, scope.type, scope.id, scope.projectIds.join(","), initialTab]);

  const tunnelCommand = useMemo(() => {
    const destination = `${remote.ssh_user ? `${remote.ssh_user}@` : ""}${remote.ssh_host || "your-server"}`;
    return `ssh -N -R ${remote.remote_port}:${remote.local_host}:${remote.local_port} ${destination}`;
  }, [remote]);

  if (!open) return null;

  async function mutate(work: () => Promise<ConfigurationState>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await work();
      setState(next);
      setRemote(next.settings.remote);
      setMessage(success);
    } catch (nextError) {
      setError(formatApiError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function savePorts() {
    if (!ports) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setPorts(await saveHostPortSettings(ports));
      setMessage("Port settings saved for this machine.");
    } catch (nextError) {
      setError(formatApiError(nextError));
    } finally {
      setBusy(false);
    }
  }

  function updateReserved(index: number, patch: Partial<PortSettings["reserved"][number]>) {
    setPorts((current) => current ? {
      ...current,
      reserved: current.reserved.map((range, i) => i === index ? { ...range, ...patch } : range),
    } : current);
  }

  async function saveTheme(theme: ThemePreference) {
    applyTheme(theme);
    await mutate(() => saveGeneralConfiguration(scope, theme), "Appearance updated.");
  }

  async function createToken() {
    if (!tokenName.trim() || tokenProjects.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const expiresAt = tokenLifetime === "never"
        ? null
        : new Date(Date.now() + Number(tokenLifetime) * 86_400_000).toISOString();
      const issued = await createConfigurationToken(scope, {
        name: tokenName.trim(),
        project_ids: tokenProjects,
        role: tokenRole,
        expires_at: expiresAt,
      });
      setTokens((current) => [issued.record, ...current.filter((item) => item.id !== issued.record.id)]);
      setIssuedToken(issued.token);
      setTokenName("");
      setMessage("Access token created. Copy it before leaving this tab.");
    } catch (nextError) {
      setError(formatApiError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(token: AccessTokenSummary) {
    if (!window.confirm(`Revoke "${token.name}"? Agents using it will lose access immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      const revoked = await revokeConfigurationToken(token.id);
      setTokens((current) => current.map((item) => item.id === revoked.id ? revoked : item));
      setMessage(`Revoked ${token.name}.`);
    } catch (nextError) {
      setError(formatApiError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function createUser() {
    if (!userName.trim() || !userEmail.trim() || userPassword.length < 12) return;
    await mutate(() => createConfigurationUser(scope, {
      display_name: userName.trim(),
      email: userEmail.trim(),
      password: userPassword,
      role: state?.users.length ? userRole : "admin",
    }), state?.users.length ? "User created." : "Administrator created.");
    setUserName("");
    setUserEmail("");
    setUserPassword("");
  }

  async function connectGithubAccount() {
    if (!githubToken.trim()) return;
    await mutate(() => connectGitHub(scope, githubToken), "GitHub connected.");
    setGithubToken("");
  }

  async function disconnectGithubAccount() {
    if (!window.confirm("Disconnect GitHub? Konductor will remove the stored token.")) return;
    await mutate(() => disconnectGitHub(scope), "GitHub disconnected.");
  }

  const theme = state?.settings.general.theme ?? "system";
  const hasAdmin = state?.users.some((user) => user.role === "admin" && user.status === "active") ?? false;
  const projects = registry?.projects ?? [];

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="k-dialog cfg" role="dialog" aria-modal="true" aria-labelledby="configuration-title">
        <header className="k-dialog__header cfg__header">
          <div className="cfg__title">
            <span id="configuration-title">Configuration</span>
            <span className="cfg__scope">{scope.type === "project" ? "Project" : "Project space"}: {scope.label}</span>
          </div>
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="cfg__body">
          <nav className="cfg__nav" aria-label="Configuration sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`cfg__nav-item${tab === item.id ? " cfg__nav-item--active" : ""}`}
                onClick={() => { setTab(item.id); setMessage(null); setError(null); }}
              >
                <span>{item.label}</span>
                <small>{item.note}</small>
              </button>
            ))}
          </nav>

          <main className="cfg__content">
            {error ? <div className="k-callout k-callout--danger">{error}</div> : null}
            {message ? <div className="k-callout k-callout--success">{message}</div> : null}
            {!state ? <p className="k-loading">Loading configuration…</p> : null}

            {state && tab === "general" ? (
              <div className="cfg__stack">
                <div>
                  <h2 className="cfg__heading">Appearance</h2>
                  <p className="cfg__intro">Choose how this configuration scope renders on this device.</p>
                </div>
                <div className="cfg__theme-grid" role="radiogroup" aria-label="Theme">
                  {(["system", "light", "dark"] as ThemePreference[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={theme === option}
                      className={`cfg__theme${theme === option ? " cfg__theme--active" : ""}`}
                      onClick={() => void saveTheme(option)}
                      disabled={busy}
                    >
                      <span className={`cfg__theme-preview cfg__theme-preview--${option}`} aria-hidden="true"><i /><i /></span>
                      <strong>{option === "system" ? "Use system" : option[0]!.toUpperCase() + option.slice(1)}</strong>
                      <small>{option === "system" ? "Follow the operating system" : `Always use ${option} mode`}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {state && tab === "integrations" ? (
              <div className="cfg__stack">
                <div>
                  <h2 className="cfg__heading">Integrations</h2>
                  <p className="cfg__intro">Connect services that Konductor can use for this {scope.type === "project" ? "project" : "project space"}.</p>
                </div>
                <section className="cfg__integration">
                  <div className="cfg__integration-mark" aria-hidden="true">GH</div>
                  <div className="cfg__integration-copy">
                    <h3>GitHub</h3>
                    {state.settings.integrations.github ? (
                      <p>Connected as <strong>@{state.settings.integrations.github.login}</strong>{state.settings.integrations.github.name ? ` (${state.settings.integrations.github.name})` : ""}.</p>
                    ) : <p>Connect GitHub to let Konductor use your repository access in future workflows.</p>}
                  </div>
                  {state.settings.integrations.github ? <span className="cfg__connected">Connected</span> : null}
                </section>
                {state.settings.integrations.github ? (
                  <div className="k-actions"><button type="button" className="k-btn k-btn--danger" disabled={busy} onClick={() => void disconnectGithubAccount()}>Disconnect GitHub</button></div>
                ) : (
                  <section className="cfg__panel">
                    <h3>Connect your account</h3>
                    <p className="cfg__integration-help">Paste a GitHub fine-grained personal access token. Konductor verifies it, stores it only in host-protected secret storage, and never shows it again.</p>
                    <label className="k-field"><span className="k-label">Personal access token</span><input className="k-input" type="password" autoComplete="off" value={githubToken} placeholder="github_pat_…" onChange={(event) => setGithubToken(event.target.value)} /></label>
                    <div className="k-actions"><button type="button" className="k-btn k-btn--primary" disabled={busy || !githubToken.trim()} onClick={() => void connectGithubAccount()}>Connect GitHub</button></div>
                  </section>
                )}
              </div>
            ) : null}

            {state && tab === "remote" ? (
              <div className="cfg__stack">
                <div>
                  <h2 className="cfg__heading">Remote access</h2>
                  <p className="cfg__intro">Prepare an SSH reverse tunnel without exposing Konductor directly to the network.</p>
                </div>
                <div className="k-callout k-callout--warning">
                  Scaffold only. Konductor stores this plan but does not start or supervise the tunnel yet.
                </div>
                {!state.settings.auth.enabled ? (
                  <div className="k-callout">
                    Sharing this dashboard with other people? Turn on authentication first so everyone signs in with their own account.{" "}
                    <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => { setTab("auth"); setMessage(null); setError(null); }}>Set up authentication</button>
                  </div>
                ) : null}
                <label className="cfg__toggle-row">
                  <span><strong>Prepare remote access</strong><small>Marks this scope ready for a managed forwarding flow.</small></span>
                  <input
                    type="checkbox"
                    checked={remote.enabled}
                    disabled={!state.settings.auth.enabled}
                    onChange={(event) => setRemote({ ...remote, enabled: event.target.checked })}
                  />
                </label>
                <div className="k-field-grid">
                  <label className="k-field"><span className="k-label">SSH host</span><input className="k-input" value={remote.ssh_host} placeholder="host.example.com" onChange={(event) => setRemote({ ...remote, ssh_host: event.target.value })} /></label>
                  <label className="k-field"><span className="k-label">SSH user</span><input className="k-input" value={remote.ssh_user} placeholder="deploy" onChange={(event) => setRemote({ ...remote, ssh_user: event.target.value })} /></label>
                  <label className="k-field"><span className="k-label">Local Konductor port</span><input className="k-input" type="number" min="1" max="65535" value={remote.local_port} onChange={(event) => setRemote({ ...remote, local_port: Number(event.target.value) })} /></label>
                  <label className="k-field"><span className="k-label">Remote forwarded port</span><input className="k-input" type="number" min="1" max="65535" value={remote.remote_port} onChange={(event) => setRemote({ ...remote, remote_port: Number(event.target.value) })} /></label>
                </div>
                <div className="cfg__command"><span>Planned command</span><code>{tunnelCommand}</code></div>
                <div className="k-actions"><button type="button" className="k-btn k-btn--primary" disabled={busy || (remote.enabled && (!remote.ssh_host || !state.settings.auth.enabled))} onClick={() => void mutate(() => saveRemoteConfiguration(scope, remote), "Remote plan saved.")}>Save remote plan</button></div>
              </div>
            ) : null}

            {state && tab === "ports" ? (
              <div className="cfg__stack">
                <div>
                  <h2 className="cfg__heading">Ports</h2>
                  <p className="cfg__intro">
                    Machine-wide, shared by every project and Project Profile on this host. Preview instances take the first free
                    port from the preview range and never touch a reserved port.
                  </p>
                </div>
                {!ports ? <p className="k-loading">Loading port settings…</p> : (
                  <>
                    <div className="k-field-grid">
                      <label className="k-field"><span className="k-label">Preview range start</span><input className="k-input" type="number" min="1" max="65535" value={ports.preview_range.start} onChange={(event) => setPorts({ ...ports, preview_range: { ...ports.preview_range, start: Number(event.target.value) } })} /></label>
                      <label className="k-field"><span className="k-label">Preview range end</span><input className="k-input" type="number" min="1" max="65535" value={ports.preview_range.end} onChange={(event) => setPorts({ ...ports, preview_range: { ...ports.preview_range, end: Number(event.target.value) } })} /></label>
                    </div>
                    {ports.preview_range.end - ports.preview_range.start + 1 < 5 && (
                      <div className="k-callout k-callout--warning">Fewer than five ports in the preview range; parallel previews will run out quickly.</div>
                    )}
                    <div>
                      <h3>Reserved ports</h3>
                      <p className="cfg__integration-help">Write down ports other services on this machine occupy. A single port has the same start and end.</p>
                    </div>
                    {ports.reserved.length === 0 ? <p className="k-empty">No reserved ports</p> : (
                      <div className="k-table-scroll">
                        <table className="k-table k-table--static">
                          <thead><tr><th>Start</th><th>End</th><th>Label</th><th /></tr></thead>
                          <tbody>
                            {ports.reserved.map((range, index) => (
                              <tr key={index}>
                                <td><input className="k-input" type="number" min="1" max="65535" value={range.start} onChange={(event) => updateReserved(index, { start: Number(event.target.value) })} /></td>
                                <td><input className="k-input" type="number" min="1" max="65535" value={range.end} onChange={(event) => updateReserved(index, { end: Number(event.target.value) })} /></td>
                                <td><input className="k-input" value={range.label} placeholder="What uses it" onChange={(event) => updateReserved(index, { label: event.target.value })} /></td>
                                <td style={{ textAlign: "right" }}>
                                  <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--danger" onClick={() => setPorts({ ...ports, reserved: ports.reserved.filter((_, i) => i !== index) })}>Remove</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="k-actions">
                      <button type="button" className="k-btn" onClick={() => setPorts({ ...ports, reserved: [...ports.reserved, { start: 3000, end: 3000, label: "" }] })}>Add reservation</button>
                      <span className="k-spacer" />
                      <button type="button" className="k-btn k-btn--primary" disabled={busy} onClick={() => void savePorts()}>Save port settings</button>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {state && tab === "tokens" ? (
              <div className="cfg__stack">
                <div>
                  <h2 className="cfg__heading">Access tokens</h2>
                  <p className="cfg__intro">Create credentials for external agents and choose exactly which projects accept each token.</p>
                </div>
                {issuedToken ? (
                  <div className="cfg__issued">
                    <strong>Copy this token now</strong>
                    <p>Konductor stores only its hash. It cannot show this value again.</p>
                    <div><code>{issuedToken}</code><button type="button" className="k-btn k-btn--sm" onClick={() => void navigator.clipboard.writeText(issuedToken)}>Copy</button></div>
                  </div>
                ) : null}
                <section className="cfg__panel">
                  <h3>Create external token</h3>
                  <div className="k-field-grid">
                    <label className="k-field"><span className="k-label">Token name</span><input className="k-input" value={tokenName} placeholder="Release reviewer" onChange={(event) => setTokenName(event.target.value)} /></label>
                    <label className="k-field"><span className="k-label">Role</span><select className="k-select" value={tokenRole} onChange={(event) => setTokenRole(event.target.value as TokenRole)}><option value="observer">Observer</option><option value="contributor">Contributor</option><option value="operator">Operator</option><option value="administrator">Administrator</option></select><small className="cfg__role-help">{TOKEN_ROLE_HELP[tokenRole as Exclude<TokenRole, "custom">]}</small></label>
                    <label className="k-field"><span className="k-label">Lifetime</span><select className="k-select" value={tokenLifetime} onChange={(event) => setTokenLifetime(event.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="never">No expiry</option></select></label>
                  </div>
                  <fieldset className="cfg__projects">
                    <legend>Valid in</legend>
                    {projects.map((project) => (
                      <label key={project.id} className="cfg__project-choice">
                        <input type="checkbox" checked={tokenProjects.includes(project.id)} onChange={() => setTokenProjects((current) => current.includes(project.id) ? current.filter((id) => id !== project.id) : [...current, project.id])} />
                        <span><strong>{project.name}</strong><small>{project.id}</small></span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="k-actions"><button type="button" className="k-btn k-btn--primary" disabled={busy || !tokenName.trim() || tokenProjects.length === 0} onClick={() => void createToken()}>Create token</button></div>
                </section>
                <section className="cfg__panel cfg__panel--flush">
                  <h3>Tokens in this scope</h3>
                  {tokens.length === 0 ? <p className="k-empty cfg__empty">No access tokens yet.</p> : (
                    <div className="cfg__token-list">
                      {tokens.map((token) => {
                        const status = tokenState(token);
                        return (
                          <div key={token.id} className="cfg__token-row">
                            <div className="cfg__token-main"><strong>{token.name}</strong><code>{token.prefix}…</code><div className="k-tags">{token.grants.map((grant) => <span key={grant.project_id} className="k-tag">{grant.project_id}</span>)}</div></div>
                            <div className="cfg__token-meta"><span className={`cfg__state cfg__state--${status}`}>{status}</span><span>{token.kind === "internal" ? `Managed · ${token.agent_profile_id}` : `Expires ${formatDate(token.expires_at)}`}</span></div>
                            {token.kind === "external" && status === "active" ? <button type="button" className="k-btn k-btn--sm k-btn--danger" disabled={busy} onClick={() => void revokeToken(token)}>Revoke</button> : <span className="cfg__managed">{token.kind === "internal" ? "Managed" : ""}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            ) : null}

            {state && tab === "auth" ? (
              <div className="cfg__stack">
                <div>
                  <h2 className="cfg__heading">Authentication</h2>
                  <p className="cfg__intro">Create the first administrator, then require sign-in for the dashboard.</p>
                </div>
                <label className="cfg__toggle-row">
                  <span><strong>Require authentication</strong><small>{hasAdmin ? "Everyone must sign in once enabled." : "Create an administrator before enabling."}</small></span>
                  <input type="checkbox" checked={state.settings.auth.enabled} disabled={busy || !hasAdmin} onChange={(event) => void mutate(() => saveAuthenticationEnabled(scope, event.target.checked), event.target.checked ? "Authentication enabled." : "Authentication disabled.").then(() => refreshAuth())} />
                </label>
                <section className="cfg__panel">
                  <h3>{state.users.length === 0 ? "Create administrator" : "Add user"}</h3>
                  <div className="k-field-grid">
                    <label className="k-field"><span className="k-label">Name</span><input className="k-input" value={userName} onChange={(event) => setUserName(event.target.value)} /></label>
                    <label className="k-field"><span className="k-label">Email</span><input className="k-input" type="email" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} /></label>
                    <label className="k-field"><span className="k-label">Password</span><input className="k-input" type="password" minLength={12} value={userPassword} placeholder="At least 12 characters" onChange={(event) => setUserPassword(event.target.value)} /></label>
                    {state.users.length > 0 ? <label className="k-field"><span className="k-label">Role</span><select className="k-select" value={userRole} onChange={(event) => setUserRole(event.target.value as "admin" | "member")}><option value="member">Member</option><option value="admin">Administrator</option></select></label> : null}
                  </div>
                  <div className="k-actions"><button type="button" className="k-btn k-btn--primary" disabled={busy || !userName.trim() || !userEmail.trim() || userPassword.length < 12} onClick={() => void createUser()}>{state.users.length === 0 ? "Create administrator" : "Add user"}</button></div>
                </section>
                <section className="cfg__panel cfg__panel--flush">
                  <h3>Users</h3>
                  {state.users.length === 0 ? <p className="k-empty cfg__empty">No users yet. The first user becomes the administrator.</p> : (
                    <div className="cfg__user-list">
                      {state.users.map((user) => <div key={user.id} className="cfg__user-row"><span className="cfg__avatar">{user.display_name.slice(0, 1).toUpperCase()}</span><span><strong>{user.display_name}</strong><small>{user.email}</small></span><span className="k-tag">{user.role}</span><span className="cfg__permissions">Permissions coming later</span></div>)}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  );
}
