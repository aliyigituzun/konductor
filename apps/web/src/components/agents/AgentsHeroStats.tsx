import { s } from "../../styles/ui.js";
import type { AdapterInfo, FleetAgent, HostHealth } from "../../lib/registry.js";
import type { AgentProfile, PromptPack, SkillProfile } from "../../lib/types.js";

interface AgentsHeroStatsProps {
  hostHealth: HostHealth | null;
  fleet: FleetAgent[];
  adapters: AdapterInfo[];
  profiles: AgentProfile[];
  promptPacks: PromptPack[];
  skillProfiles: SkillProfile[];
}

function Card({ title, value, text }: { title: string; value: string; text: string }) {
  return (
    <div style={s.heroCard}>
      <div style={s.heroTitle}>{title}</div>
      <div style={s.heroValue}>{value}</div>
      <div style={s.heroText}>{text}</div>
    </div>
  );
}

/** Four numbers that answer "can I launch an agent right now, and what is running?" */
export function AgentsHeroStats({
  hostHealth,
  fleet,
  adapters,
  profiles,
  promptPacks,
  skillProfiles,
}: AgentsHeroStatsProps) {
  const installed = adapters.filter((adapter) => adapter.installed);
  const blocked = fleet.filter((agent) => agent.agent_status === "blocked");

  return (
    <div style={s.heroGrid}>
      <Card
        title="Host"
        value={hostHealth?.running ? "up" : "down"}
        text={
          hostHealth?.running
            ? `pid ${hostHealth.pid ?? "?"} on port ${hostHealth.port}`
            : "Start it with `konductor host start`."
        }
      />
      <Card
        title="Live agents"
        value={String(fleet.length)}
        text={
          blocked.length > 0
            ? `${blocked.length} waiting on you: ${blocked.map((a) => a.slug).join(", ")}`
            : fleet.length > 0
              ? fleet.map((a) => a.slug).join(", ")
              : "Nothing running."
        }
      />
      <Card
        title="Agents available"
        value={`${installed.length}/${adapters.length}`}
        text={
          adapters.length === 0
            ? "No adapters loaded."
            : `${installed.map((a) => a.title).join(", ") || "None installed"}`
        }
      />
      <Card
        title="Configuration"
        value={String(profiles.length)}
        text={`${profiles.length} profile(s) · ${promptPacks.length} prompt pack(s) · ${skillProfiles.length} skill(s)`}
      />
    </div>
  );
}
