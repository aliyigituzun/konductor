import type { SkillInstallResult, SkillLink } from "../../lib/registry.js";
import type { SkillProfile } from "../../lib/types.js";

interface SkillProfilesPanelProps {
  skillProfiles: SkillProfile[];
  query: string;
  onQueryChange: (query: string) => void;
  link: SkillLink | null;
  linkMessage: string | null;
  installingPackage: string | null;
  installResult: SkillInstallResult | null;
  onAdd: (link: SkillLink) => void;
  onInstall: (link: SkillLink) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}

/** npm packages this project's agents are expected to have available. */
export function SkillProfilesPanel({
  skillProfiles,
  query,
  onQueryChange,
  link,
  linkMessage,
  installingPackage,
  installResult,
  onAdd,
  onInstall,
  onDelete,
  busy,
}: SkillProfilesPanelProps) {
  const exists = link ? skillProfiles.some((skill) => skill.registry_url === link.url) : false;

  return (
    <div className="cfg">
      <section className="k-section">
        <div className="k-section__header">Add skill</div>
        <div className="k-section__body" style={{ display: "grid", gap: 10, paddingTop: 12 }}>
          <div className="k-field">
            <label className="k-label" htmlFor="skill-query">npm or GitHub link</label>
            <input
              id="skill-query"
              className="k-input"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="https://www.npmjs.com/package/… or https://github.com/…"
            />
          </div>
          {linkMessage ? <p className="k-note">{linkMessage}</p> : null}
          {link ? (
            <div className="k-row" style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)" }}>
              <span className="k-row__main">
                <strong>{link.name}</strong>
                <span className="k-row__meta" style={{ marginLeft: 8 }}>{link.source}</span>
              </span>
              <button type="button" className="k-btn k-btn--sm" disabled={exists || busy} onClick={() => onAdd(link)}>
                {exists ? "Added" : "Add"}
              </button>
              <button type="button" className="k-btn k-btn--sm k-btn--primary" disabled={installingPackage === link.url} onClick={() => onInstall(link)}>
                {installingPackage === link.url ? "Installing…" : "Install"}
              </button>
            </div>
          ) : null}
          {installResult ? (
            <div className={`k-callout k-mono${installResult.error ? " k-callout--danger" : ""}`}>
              {installResult.command}
              {installResult.error ? `\n\n${installResult.error}` : ""}
              {installResult.stdout ? `\n\n${installResult.stdout}` : ""}
              {installResult.stderr ? `\n\n${installResult.stderr}` : ""}
            </div>
          ) : null}
        </div>
      </section>

      <section className="k-section">
        <div className="k-section__header">Skills<span className="k-section__count">{skillProfiles.length}</span></div>
        <div className="k-section__body k-section__body--flush">
          {skillProfiles.length === 0 ? (
            <p className="k-empty" style={{ padding: 10 }}>None</p>
          ) : (
            skillProfiles.map((skill) => (
              <div key={skill.id} className="k-row" style={{ minHeight: 34 }}>
                <span className="k-row__main">
                  <strong>{skill.title}</strong>
                  <span className="k-row__meta" style={{ marginLeft: 8 }}>
                    {skill.package_name}{skill.latest_version ? ` · v${skill.latest_version}` : ""}
                  </span>
                  {skill.install_command ? <div className="k-row__meta k-mono">{skill.install_command}</div> : null}
                </span>
                <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--danger" disabled={busy} onClick={() => onDelete(skill.id)}>Remove</button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
