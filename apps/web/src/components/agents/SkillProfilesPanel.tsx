import { s } from "../../styles/ui.js";
import type { NpmSkillSearchResult, SkillInstallResult } from "../../lib/registry.js";
import type { SkillProfile } from "../../lib/types.js";

interface SkillProfilesPanelProps {
  skillProfiles: SkillProfile[];
  query: string;
  onQueryChange: (query: string) => void;
  results: NpmSkillSearchResult[];
  searchMessage: string | null;
  installingPackage: string | null;
  installResult: SkillInstallResult | null;
  onAdd: (result: NpmSkillSearchResult) => void;
  onInstall: (result: NpmSkillSearchResult) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}

/** npm packages this project's agents are expected to have available. */
export function SkillProfilesPanel({
  skillProfiles,
  query,
  onQueryChange,
  results,
  searchMessage,
  installingPackage,
  installResult,
  onAdd,
  onInstall,
  onDelete,
  busy,
}: SkillProfilesPanelProps) {
  return (
    <section style={s.section}>
      <div style={s.sectionHeader}>Skill Profiles</div>
      <div style={s.sectionBody}>
        <div style={s.workspaceGrid}>
          <div style={s.panelCard}>
            <div style={s.panelTitle}>Registry Search</div>
            <p style={s.panelText}>
              Search npm, record packages as project skill profiles, and optionally run the
              install from here.
            </p>
            <div>
              <label style={s.label} htmlFor="skill-query">
                Search npm
              </label>
              <input
                id="skill-query"
                style={s.input}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="eslint plugin, codemod, openapi generator…"
              />
            </div>
            {searchMessage ? <p style={s.helper}>{searchMessage}</p> : null}
            <div style={s.searchGrid}>
              {results.map((result) => {
                const pkg = result.package;
                const exists = skillProfiles.some((skill) => skill.package_name === pkg.name);
                return (
                  <article key={pkg.name} style={s.itemCard}>
                    <div style={s.itemHeader}>
                      <div>
                        <div style={s.itemTitle}>{pkg.name}</div>
                        <div style={s.itemMeta}>v{pkg.version}</div>
                      </div>
                    </div>
                    <p style={s.itemMeta}>{pkg.description ?? "No package description."}</p>
                    {pkg.keywords && pkg.keywords.length > 0 ? (
                      <div style={s.tagRow}>
                        {pkg.keywords.slice(0, 5).map((keyword) => (
                          <span key={keyword} style={s.tag}>
                            {keyword}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div style={s.actionsRow}>
                      <button
                        type="button"
                        style={exists ? s.subtleButton : s.button}
                        disabled={exists || busy}
                        onClick={() => onAdd(result)}
                      >
                        {exists ? "Already added" : "Add skill profile"}
                      </button>
                      <button
                        type="button"
                        style={s.primaryButton}
                        disabled={installingPackage === pkg.name}
                        onClick={() => onInstall(result)}
                      >
                        {installingPackage === pkg.name ? "Installing…" : "Run npm install"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div style={s.panelCard}>
            <div style={s.panelTitle}>Installed Skill Profiles</div>
            <p style={s.panelText}>
              What external packages belong to this project, and how to install them again.
            </p>
            <div style={s.itemList}>
              {skillProfiles.length === 0 ? (
                <p style={s.empty}>No skill profiles saved yet.</p>
              ) : (
                skillProfiles.map((skill) => (
                  <article key={skill.id} style={s.itemCard}>
                    <div style={s.itemHeader}>
                      <div>
                        <div style={s.itemTitle}>{skill.title}</div>
                        <div style={s.itemMeta}>
                          {skill.package_name}
                          {skill.latest_version ? ` · v${skill.latest_version}` : ""}
                        </div>
                      </div>
                    </div>
                    {skill.description ? <p style={s.itemMeta}>{skill.description}</p> : null}
                    {skill.install_command ? (
                      <code style={s.itemMeta}>{skill.install_command}</code>
                    ) : null}
                    <div style={s.actionsRow}>
                      <button
                        type="button"
                        style={s.dangerButton}
                        disabled={busy}
                        onClick={() => onDelete(skill.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
            {installResult ? (
              <div
                style={{
                  ...s.callout,
                  borderColor: installResult.error
                    ? "rgba(185, 28, 28, 0.22)"
                    : "rgba(15, 118, 110, 0.22)",
                }}
              >
                <strong style={s.calloutTitle}>npm command</strong>
                {installResult.command}
                {installResult.error ? `\n\n${installResult.error}` : ""}
                {installResult.stdout ? `\n\nstdout:\n${installResult.stdout}` : ""}
                {installResult.stderr ? `\n\nstderr:\n${installResult.stderr}` : ""}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
