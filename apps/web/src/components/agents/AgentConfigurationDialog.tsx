import { useEffect } from "react";
import type { AdapterInfo, SkillInstallResult, SkillLink } from "../../lib/registry.js";
import type { AgentProfile, PromptPack, SkillProfile } from "../../lib/types.js";
import { AgentProfilesPanel } from "./AgentProfilesPanel.js";
import { AssetAccessPanel } from "./AssetAccessPanel.js";
import { ProviderConnectionsPanel, type ProviderConnectionDraft } from "./ProviderConnectionsPanel.js";
import type { ProfileDraft, PromptPackDraft } from "./helpers.js";
import { PromptPacksPanel } from "./PromptPacksPanel.js";
import { SkillProfilesPanel } from "./SkillProfilesPanel.js";
import "./Agents.css";

export type ConfigurationSection = "profiles" | "providers" | "prompts" | "skills" | "assets";

interface AgentConfigurationDialogProps {
  open: boolean;
  projectId: string;
  section: ConfigurationSection;
  onSectionChange: (section: ConfigurationSection) => void;
  onClose: () => void;
  profiles: AgentProfile[];
  defaultProfile: string;
  adapters: AdapterInfo[];
  adaptersLoading: boolean;
  adaptersError: string | null;
  onRetryAdapters: () => void;
  profileDraft: ProfileDraft;
  onProfileDraftChange: (draft: ProfileDraft) => void;
  onAddProfile: () => void;
  onDeleteProfile: (id: string) => void;
  onSetDefaultProfile: (id: string) => void;
  providerConnections: import("../../lib/types.js").ProviderConnection[];
  providerDraft: ProviderConnectionDraft;
  onProviderDraftChange: (draft: ProviderConnectionDraft) => void;
  onAddProvider: () => void;
  onToggleProvider: (id: string) => void;
  onDeleteProvider: (id: string) => void;
  promptPacks: PromptPack[];
  packDraft: PromptPackDraft;
  onPackDraftChange: (draft: PromptPackDraft) => void;
  onAddPack: () => void;
  onDeletePack: (id: string) => void;
  skillProfiles: SkillProfile[];
  skillQuery: string;
  onSkillQueryChange: (query: string) => void;
  skillLink: SkillLink | null;
  skillLinkMessage: string | null;
  installingPackage: string | null;
  installResult: SkillInstallResult | null;
  onAddSkill: (link: SkillLink) => void;
  onInstallSkill: (link: SkillLink) => void;
  onDeleteSkill: (id: string) => void;
  busy: boolean;
  error: string | null;
  message: string | null;
}

const sections: Array<{ id: ConfigurationSection; label: string }> = [
  { id: "profiles", label: "Profiles" },
  { id: "providers", label: "Providers" },
  { id: "prompts", label: "Prompt packs" },
  { id: "skills", label: "Skills" },
  { id: "assets", label: "Assets" },
];

/** Project-scoped launch configuration, kept out of the day-to-day fleet surface. */
export function AgentConfigurationDialog(props: AgentConfigurationDialogProps) {
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={props.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-configuration-title"
        className="k-dialog k-dialog--config"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="k-dialog__header">
          <span id="agent-configuration-title">Agent configuration</span>
          <span className="k-spacer" />
          <button type="button" aria-label="Close" className="k-dialog__close" onClick={props.onClose}>×</button>
        </div>

        <div className="cfg__tabs" role="tablist">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={props.section === item.id}
              className={`cfg__tab${props.section === item.id ? " cfg__tab--active" : ""}`}
              onClick={() => props.onSectionChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="k-dialog__body">
          {props.adaptersError ? (
            <div className="ag__msg ag__msg--error">
              <span>{props.adaptersError}</span>
              <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={props.onRetryAdapters}>
                Retry harnesses
              </button>
            </div>
          ) : props.error ? <div className="ag__msg ag__msg--error">{props.error}</div>
            : props.message ? <div className="ag__msg">{props.message}</div> : null}
          {props.section === "profiles" ? (
            <AgentProfilesPanel
              profiles={props.profiles}
              defaultProfile={props.defaultProfile}
              adapters={props.adapters}
              adaptersLoading={props.adaptersLoading}
              adaptersError={props.adaptersError}
              providerConnections={props.providerConnections}
              draft={props.profileDraft}
              onDraftChange={props.onProfileDraftChange}
              onAdd={props.onAddProfile}
              onDelete={props.onDeleteProfile}
              onSetDefault={props.onSetDefaultProfile}
              busy={props.busy}
            />
          ) : null}
          {props.section === "providers" ? <ProviderConnectionsPanel connections={props.providerConnections} adapters={props.adapters} draft={props.providerDraft} onDraftChange={props.onProviderDraftChange} onAdd={props.onAddProvider} onToggle={props.onToggleProvider} onDelete={props.onDeleteProvider} busy={props.busy} /> : null}
          {props.section === "prompts" ? (
            <PromptPacksPanel
              promptPacks={props.promptPacks}
              draft={props.packDraft}
              onDraftChange={props.onPackDraftChange}
              onAdd={props.onAddPack}
              onDelete={props.onDeletePack}
              busy={props.busy}
            />
          ) : null}
          {props.section === "skills" ? (
            <SkillProfilesPanel
              skillProfiles={props.skillProfiles}
              query={props.skillQuery}
              onQueryChange={props.onSkillQueryChange}
              link={props.skillLink}
              linkMessage={props.skillLinkMessage}
              installingPackage={props.installingPackage}
              installResult={props.installResult}
              onAdd={props.onAddSkill}
              onInstall={props.onInstallSkill}
              onDelete={props.onDeleteSkill}
              busy={props.busy}
            />
          ) : null}
          {props.section === "assets" ? (
            <AssetAccessPanel projectId={props.projectId} profiles={props.profiles} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
