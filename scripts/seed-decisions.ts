/**
 * Seeds Konductor's own project with sample decisions: open ones with options, and
 * resolved ones with outcomes. Re-running is a no-op for decisions that already exist.
 *
 *   bun run scripts/seed-decisions.ts [repoPath]
 */
import { resolve } from "node:path";
import {
  createDecision,
  listDecisions,
  readStatus,
  resolveDecision,
  updateDecision,
  type CreateDecisionInput,
} from "../packages/store/src/index.ts";

const repo = resolve(process.argv[2] ?? process.cwd());
const status = await readStatus(repo);
if (!status) {
  console.error(`No status snapshot under ${repo}. Run \`konductor init\` first.`);
  process.exit(1);
}

const featureIds = new Set((status.features ?? []).flatMap((category) => category.items.map((item) => item.id)));
const categoryIds = new Set((status.features ?? []).map((category) => category.id));
const phaseIds = new Set((status.feature_phases ?? []).map((phase) => phase.id));
const features = (...ids: string[]) => ids.filter((id) => featureIds.has(id));
const category = (id: string) => (categoryIds.has(id) ? id : [...categoryIds][0] ?? "");
const phases = (...ids: string[]) => ids.filter((id) => phaseIds.has(id));

type Seed = CreateDecisionInput & { id: string; resolve?: { option_id: string; rationale: string; resolved_at: string } };

const seeds: Seed[] = [
  {
    id: "profile-persistence",
    title: "How Project Profiles should persist",
    question: "Where does Project Profile membership live once it leaves the browser prototype?",
    context: "Profiles are portfolio contexts, not agent profiles. Migration must adopt the existing registry into one default profile without changing project ids, paths, or run history.",
    impact: "high",
    owner: "ali",
    options: [
      {
        id: "registry-namespace",
        title: "Namespace the host registry",
        description: "Add a profile_id column to the projects table and scope registry reads by it.",
        consequences: "One migration; every registry API grows a profile parameter.",
        creates_features: [
          { title: "Profile membership migration", description: "Adopt the current registry into a default profile.", category_id: category("cli"), phase_ids: phases("phase-3") },
          { title: "Profile-scoped project list", category_id: category("dashboard"), phase_ids: phases("phase-3") },
        ],
      },
      {
        id: "profile-databases",
        title: "One SQLite file per profile",
        description: "Each profile owns its own host state database under $KONDUCTOR_HOME/profiles/<id>.",
        consequences: "Clean isolation, but runs and tokens must be moved between files when a project changes profile.",
        creates_features: [],
      },
      {
        id: "keep-prototype",
        title: "Keep the browser-only prototype",
        description: "Defer persistence until remote hosts exist.",
        creates_features: [],
      },
    ],
    feature_item_ids: features("portfolio", "project-detail"),
    source: "dashboard",
    run_id: null,
    created_at: "2026-09-15T09:30:00.000Z",
  },
  {
    id: "terminal-mirror",
    title: "Terminal mirroring approach",
    question: "Keep the read-and-send tmux mirror, or move to a real browser terminal?",
    context: "DESIGN.md calls the dashboard terminal a read-and-send mirror, not a full browser terminal. Operators keep asking for scrollback and key passthrough.",
    impact: "medium",
    owner: "ali",
    options: [
      { id: "keep-mirror", title: "Keep the read-and-send mirror", description: "Poll pane screen, send lines; explicit takeover via tmux attach.", creates_features: [] },
      {
        id: "xterm",
        title: "xterm.js over a pane WebSocket",
        description: "Stream raw pane output to xterm.js and forward keystrokes.",
        consequences: "Interactive prompts work in-browser; conflicts with the explicit operator-control model.",
        creates_features: [{ title: "Pane WebSocket stream", category_id: category("dashboard"), phase_ids: phases("phase-3") }],
      },
    ],
    feature_item_ids: features("project-detail", "run-logs"),
    source: "agent",
    run_id: null,
    created_at: "2026-09-16T14:05:00.000Z",
  },
  {
    id: "asset-previews",
    title: "Asset preview generation",
    question: "When should managed asset previews be generated?",
    impact: "low",
    options: [
      { id: "on-upload", title: "On upload", description: "Generate thumbnails as part of the upload request.", consequences: "Slower uploads, simpler reads.", creates_features: [] },
      { id: "on-demand", title: "On demand", description: "Generate and cache the first time a preview is requested.", creates_features: [] },
      { id: "none", title: "No previews", description: "Show file type and size only.", creates_features: [] },
    ],
    feature_item_ids: [],
    source: "dashboard",
    run_id: null,
    created_at: "2026-09-17T08:20:00.000Z",
  },
  {
    id: "agent-runner",
    title: "Agent runner transport",
    question: "Drive coding agents through provider API calls, or supervise real harness TUIs in tmux?",
    context: "The first runner called provider APIs directly and lost the harness features operators rely on: permissions prompts, resume, and the agent's own tooling.",
    impact: "high",
    owner: "ali",
    options: [
      { id: "api-runner", title: "API-call runner", description: "Konductor owns the agent loop and calls the model API itself.", consequences: "Re-implements every harness feature.", creates_features: [] },
      {
        id: "tmux-fleet",
        title: "tmux-backed fleet",
        description: "Launch the vendor harness in a tmux window and classify its screen.",
        consequences: "Needs tmux; screen-status patterns per adapter.",
        creates_features: [],
      },
    ],
    feature_item_ids: features("run-start", "run-list", "run-show", "run-logs", "run-stop", "host-start"),
    source: "dashboard",
    run_id: null,
    created_at: "2026-09-10T10:00:00.000Z",
    resolve: {
      option_id: "tmux-fleet",
      rationale: "Real TUIs keep permission prompts, resume, and takeover. Host re-adopts surviving windows after restart.",
      resolved_at: "2026-09-11T16:40:00.000Z",
    },
  },
  {
    id: "status-storage",
    title: "Where mutable project state lives",
    question: "Keep everything in the JSON status snapshot, or move frequently changing records into SQLite?",
    impact: "high",
    owner: "ali",
    options: [
      { id: "json-only", title: "JSON snapshot only", description: "One human-readable file with backups.", consequences: "Whole-file rewrites race under concurrent agents.", creates_features: [] },
      { id: "sqlite-all", title: "Move the whole snapshot into SQLite", description: "Normalize phases, features, and issues into tables.", consequences: "Loses the interchange file agents already write.", creates_features: [] },
      {
        id: "hybrid",
        title: "SQLite for mutable records, JSON for the snapshot",
        description: "Updates, telemetry, assets, and decisions move to .konductor/state.sqlite; the snapshot stays a JSON interchange file.",
        creates_features: [],
      },
    ],
    feature_item_ids: features("updates-feed", "write-status", "write-update"),
    source: "dashboard",
    run_id: null,
    created_at: "2026-09-12T11:15:00.000Z",
    resolve: {
      option_id: "hybrid",
      rationale: "Transactional appends where writers collide; the snapshot remains the agent-facing contract. See STORAGE.md.",
      resolved_at: "2026-09-13T09:05:00.000Z",
    },
  },
  {
    id: "mcp-auth",
    title: "MCP authorization granularity",
    question: "Authorize once per MCP session, or recheck the token on every tool call?",
    impact: "medium",
    owner: "ali",
    options: [
      { id: "per-session", title: "Once per session", description: "Validate the token at startup and trust the process afterwards.", consequences: "Revocation only takes effect on restart.", creates_features: [] },
      { id: "per-call", title: "Recheck every tool call", description: "Each protected tool rechecks grant, capability, expiry, and revocation.", creates_features: [] },
    ],
    feature_item_ids: features("agent-tokens", "mcp-serve"),
    source: "agent",
    run_id: null,
    created_at: "2026-09-14T13:00:00.000Z",
    resolve: {
      option_id: "per-call",
      rationale: "Revocation and expiry must bite mid-run; successful calls, not process starts, record usage.",
      resolved_at: "2026-09-14T17:30:00.000Z",
    },
  },
];

const existing = new Set((await listDecisions(repo)).map((decision) => decision.id));
let created = 0;
for (const { resolve: resolution, ...seed } of seeds) {
  if (existing.has(seed.id)) {
    console.log(`= ${seed.id} (exists)`);
    continue;
  }
  await createDecision(repo, seed);
  if (resolution) {
    await resolveDecision(repo, seed.id, { ...resolution, resolved_by: "dashboard" });
  }
  created += 1;
  console.log(`+ ${seed.id}${resolution ? " (resolved)" : ""}`);
}

// The legacy decisions_needed entry is imported without options; give it some.
const legacy = (await listDecisions(repo)).find((decision) => decision.id === "tool-activity-signal");
if (legacy && legacy.status === "open" && legacy.options.length === 0) {
  await updateDecision(repo, legacy.id, {
    title: "Tool activity signal source",
    question: "How should tool and file activity be captured when Claude Code emits no OTEL spans?",
    options: [
      { id: "otel-logs", title: "OTEL log events", description: "Rely on tool_use log events once confirmed in an interactive session.", creates_features: [] },
      { id: "hooks", title: "Claude Code hooks", description: "Capture PostToolUse hook payloads and forward them to the receiver.", consequences: "Adapter-specific; needs hook wiring per harness.", creates_features: [] },
    ],
    feature_item_ids: features("tool-activity", "activity-panel"),
  });
  console.log("~ tool-activity-signal (added options)");
}

console.log(`${created} decision(s) created; ${(await listDecisions(repo)).length} total.`);
