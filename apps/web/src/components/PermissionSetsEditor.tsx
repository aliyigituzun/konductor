import { USER_PERMISSION_GROUPS, validatePermissionSets } from "@konductor/schema";
import type { UserPermission, UserPermissionSet } from "../lib/types.js";

interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  sets: UserPermissionSet[];
  projects: ProjectOption[];
  disabled?: boolean;
  onChange: (sets: UserPermissionSet[]) => void;
}

export function newPermissionSet(): UserPermissionSet {
  return { id: crypto.randomUUID(), name: "", permissions: [], project_ids: [] };
}

export function permissionSetErrors(sets: UserPermissionSet[], projects: ProjectOption[]): string[] {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return validatePermissionSets(sets, (id) => names.get(id) ?? id);
}

export function summarizePermissionSets(sets: UserPermissionSet[]): string {
  if (sets.length === 0) return "No access";
  const projects = new Set(sets.flatMap((set) => set.project_ids)).size;
  return `${sets.length} ${sets.length === 1 ? "set" : "sets"} · ${projects} ${projects === 1 ? "project" : "projects"}`;
}

export function PermissionSetsEditor({ sets, projects, disabled = false, onChange }: Props) {
  const errors = permissionSetErrors(sets, projects);
  // A project may sit in only one of this user's sets, so the others show it as taken.
  const claimedBy = new Map<string, UserPermissionSet>();
  for (const set of sets) for (const projectId of set.project_ids) claimedBy.set(projectId, set);

  function update(id: string, patch: Partial<UserPermissionSet>) {
    onChange(sets.map((set) => set.id === id ? { ...set, ...patch } : set));
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  return (
    <div className="perm">
      {sets.map((set, index) => (
        <section key={set.id} className="perm__set">
          <div className="perm__set-head">
            <label className="k-field perm__name">
              <span className="k-label">Set name</span>
              <input className="k-input" value={set.name} placeholder={`Set ${index + 1}`} disabled={disabled} onChange={(event) => update(set.id, { name: event.target.value })} />
            </label>
            <button type="button" className="k-btn k-btn--sm k-btn--ghost" disabled={disabled} onClick={() => onChange(sets.filter((item) => item.id !== set.id))}>Remove</button>
          </div>
          <fieldset className="cfg__projects">
            <legend>Applies to</legend>
            {projects.length === 0 ? <p className="k-note">No projects in this space yet.</p> : null}
            {projects.map((project) => {
              const owner = claimedBy.get(project.id);
              const taken = owner !== undefined && owner.id !== set.id;
              return (
                <label key={project.id} className={`cfg__project-choice${taken ? " cfg__project-choice--taken" : ""}`}>
                  <input type="checkbox" checked={set.project_ids.includes(project.id)} disabled={disabled || taken} onChange={() => update(set.id, { project_ids: toggle(set.project_ids, project.id) })} />
                  <span><strong>{project.name}</strong><small>{taken ? `In ${owner.name.trim() || "another set"}` : project.id}</small></span>
                </label>
              );
            })}
          </fieldset>
          <div className="perm__groups">
            {USER_PERMISSION_GROUPS.map((group) => {
              const ids = group.items.map((item) => item.id);
              const selected = ids.filter((id) => set.permissions.includes(id));
              const all = selected.length === ids.length;
              return (
                <fieldset key={group.id} className="perm__group">
                  <legend>
                    <span>{group.label}{group.note ? <small>{group.note}</small> : null}</span>
                    <button type="button" className="k-btn k-btn--sm k-btn--ghost" disabled={disabled} onClick={() => update(set.id, {
                      permissions: all
                        ? set.permissions.filter((id) => !ids.includes(id))
                        : [...set.permissions, ...ids.filter((id) => !set.permissions.includes(id))],
                    })}>{all ? "Clear" : "All"}</button>
                  </legend>
                  {group.items.map((item) => (
                    <label key={item.id} className="perm__item">
                      <input type="checkbox" checked={set.permissions.includes(item.id)} disabled={disabled} onChange={() => update(set.id, { permissions: toggle<UserPermission>(set.permissions, item.id) })} />
                      <span>{item.label}{item.help ? <small>{item.help}</small> : null}</span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        </section>
      ))}
      {errors.length > 0 ? <ul className="perm__errors">{errors.map((error) => <li key={error} className="k-error">{error}</li>)}</ul> : null}
      <div>
        <button type="button" className="k-btn k-btn--sm" disabled={disabled} onClick={() => onChange([...sets, newPermissionSet()])}>Add permission set</button>
      </div>
    </div>
  );
}
