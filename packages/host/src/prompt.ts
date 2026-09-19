import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentProfile, PromptPack } from "@konductor/schema";
import { listDecisions, readAssetLibrary, readDecision, readStatus } from "@konductor/store";

/**
 * The kickoff brief handed to a harness. Pure composition over store reads, kept
 * apart from the server so it can be tested without binding a port.
 */

export async function composePrompt(
  repoPath: string,
  prompt: string,
  packs: PromptPack[],
  featureItemId: string | null | undefined,
  todoId: string | null | undefined,
  decisionId: string | null | undefined,
  runId: string,
  projectId: string,
  profile: AgentProfile,
  agentTitle: string,
  source: "dashboard" | "cli",
  mcpEnabled: boolean,
): Promise<{ text: string; feature_item_title: string | null }> {
  const featureContext = await resolveFeatureContext(repoPath, featureItemId);
  const todoBlock = await resolveTodoContext(repoPath, projectId, todoId);
  const decisionBlock = await resolveDecisionContext(repoPath, decisionId);
  const packBlocks = await Promise.all(
    packs.map(async (pack) => {
      const refs = await fileRefBlock(repoPath, pack);
      return [
        `## Prompt Pack: ${pack.title}`,
        pack.instructions,
        pack.mcp_reminder ?? null,
        refs || null,
      ]
        .filter(Boolean)
        .join("\n\n");
    }),
  );

  const text = [
    `You are running inside a Konductor-managed ${agentTitle} session.`,
    featureContext.feature_block || null,
    todoBlock || null,
    decisionBlock || null,
    ...packBlocks,
    "## Required Workflow",
    "1. Inspect the relevant code and understand the task before editing files.",
    mcpEnabled
      ? "2. Konductor MCP is expected to be available here. Start by calling get_run_context, get_project_context, and get_current_status."
      : "2. Konductor MCP may not be available. If you cannot use it, say so clearly in your updates and final output.",
    "3. Use write_update after repository inspection, after meaningful implementation steps, and whenever you hit a blocker, permission issue, or scope change.",
    featureItemId
      ? "4. If you complete or materially change the selected feature, call write_status before you finish so the dashboard reflects the outcome."
      : "4. If your work changes project state in a meaningful way, call write_status before you finish so the dashboard reflects the outcome.",
    "5. Do not report success unless the code changes actually landed and you either wrote status through MCP or explicitly explain why you could not.",
    "## Operator Prompt",
    prompt,
    "## Konductor Run Metadata",
    `run_id: ${runId}`,
    `profile_id: ${profile.id}`,
    `source: ${source}`,
    featureItemId ? `feature_item_id: ${featureItemId}` : null,
    todoId ? `todo_id: ${todoId}` : null,
    decisionId ? `decision_id: ${decisionId}` : null,
    "If the Konductor MCP server is available, use it to read project context, write incremental updates, and persist status updates with this run context.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    text,
    feature_item_title: featureContext.feature_item_title,
  };
}

/** The focused to-do brief also carries every feature and managed asset it references. */
export async function resolveTodoContext(repoPath: string, projectId: string, todoId: string | null | undefined): Promise<string> {
  if (!todoId) return "";
  const [snap, library] = await Promise.all([readStatus(repoPath), readAssetLibrary(repoPath)]);
  const todo = snap?.todos?.find((item) => item.id === todoId);
  if (!todo) return `## Selected To-do\nTo-do \`${todoId}\` was selected, but it was not found in the latest status snapshot.`;

  const featureById = new Map(
    (snap?.features ?? []).flatMap((category) => category.items.map((item) => [item.id, { ...item, category: category.title }] as const)),
  );
  const features = todo.related_feature_item_ids.map((id) => featureById.get(id)).filter(Boolean);
  const assets = todo.related_asset_ids.map((id) => library.assets.find((asset) => asset.id === id)).filter(Boolean);
  const featureLines = features.length
    ? ["### Related features", ...features.map((feature) => `- ${feature!.title} (${feature!.category}) — ${feature!.status}${feature!.description ? `: ${feature!.description}` : ""}`)]
    : [];
  const assetLines = assets.length
    ? ["### Related managed assets", ...assets.flatMap((asset) => {
      const base = `/api/project/${encodeURIComponent(projectId)}/assets/items/${encodeURIComponent(asset!.id)}`;
      const variations = asset!.variations.length
        ? asset!.variations.map((variation) => `  - ${variation.name}: ${base}/variations/${encodeURIComponent(variation.id)}/content (${variation.storage_path})`)
        : ["  - No variations uploaded yet."];
      return [`- ${asset!.name} [${asset!.id}]`, ...variations];
    })]
    : [];
  return [
    "## Selected To-do",
    `ID: ${todo.id}`,
    `Title: ${todo.title}`,
    `Status: ${todo.status}`,
    todo.description ? `Description: ${todo.description}` : null,
    ...featureLines,
    ...assetLines,
    "Use the related feature and managed-asset routes above as the working context for this to-do.",
  ].filter((line) => line !== null).join("\n");
}

export async function fileRefBlock(repoPath: string, pack: PromptPack): Promise<string> {
  if (pack.file_refs.length === 0) return "";
  const parts: string[] = [];
  for (const fileRef of pack.file_refs) {
    const filePath = join(repoPath, fileRef);
    if (!existsSync(filePath)) continue;
    try {
      const content = await readFile(filePath, "utf-8");
      parts.push(`## File Reference: ${fileRef}\n${content}`);
    } catch {
      // Best effort only.
    }
  }
  return parts.join("\n\n");
}

export async function resolveFeatureContext(repoPath: string, featureItemId: string | null | undefined): Promise<{
  feature_item_title: string | null;
  feature_block: string;
}> {
  if (!featureItemId) {
    return { feature_item_title: null, feature_block: "" };
  }

  const snap = await readStatus(repoPath);
  const feature =
    snap?.features
      ?.flatMap((category) =>
        category.items.map((item) => ({
          category_id: category.id,
          category_title: category.title,
          ...item,
        })),
      )
      .find((item) => item.id === featureItemId) ?? null;

  if (!feature) {
    return {
      feature_item_title: null,
      feature_block: `## Selected Feature Item\nFeature item \`${featureItemId}\` was selected, but it was not found in the latest status snapshot.`,
    };
  }

  const related = (await listDecisions(repoPath)).filter((decision) => decision.feature_item_ids.includes(feature.id));
  const decisionLines = related.length === 0 ? [] : [
    "",
    "### Related decisions",
    ...related.map((decision) => {
      const chosen = decision.outcome
        ? decision.outcome.answer ?? decision.options.find((option) => option.id === decision.outcome?.option_id)?.title ?? decision.outcome.option_id
        : null;
      return decision.status === "resolved"
        ? `- [resolved] ${decision.title} → ${chosen}${decision.outcome?.rationale ? ` (${decision.outcome.rationale})` : ""}`
        : `- [open] ${decision.title}: ${decision.question}${decision.problem ? ` — ${decision.problem}` : ""} (do not decide this yourself; ask the operator)`;
    }),
  ];

  return {
    feature_item_title: feature.title,
    feature_block: [
      "## Selected Feature Item",
      `ID: ${feature.id}`,
      `Category: ${feature.category_title}`,
      `Title: ${feature.title}`,
      `Status: ${feature.status}`,
      feature.description ? `Description: ${feature.description}` : null,
      ...decisionLines,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}

/** The chosen option of a resolved decision, so the agent carries it out rather than re-deciding. */
export async function resolveDecisionContext(repoPath: string, decisionId: string | null | undefined): Promise<string> {
  if (!decisionId) return "";
  const decision = await readDecision(repoPath, decisionId);
  if (!decision) {
    return `## Decision Hand-off\nDecision \`${decisionId}\` was selected, but it was not found in the project database.`;
  }
  const chosen = decision.outcome
    ? decision.options.find((option) => option.id === decision.outcome?.option_id) ?? null
    : null;
  const snap = await readStatus(repoPath);
  const featureTitles = new Map(
    (snap?.features ?? []).flatMap((category) => category.items.map((item) => [item.id, `${item.title} (${category.title})`] as const)),
  );
  const linked = decision.feature_item_ids.map((id) => featureTitles.get(id) ?? id);
  const created = (decision.outcome?.created_feature_item_ids ?? []).map((id) => featureTitles.get(id) ?? id);
  const rejected = decision.options.filter((option) => option.id !== chosen?.id).map((option) => option.title);
  return [
    "## Decision Hand-off",
    `ID: ${decision.id}`,
    `Title: ${decision.title}`,
    `Question: ${decision.question}`,
    decision.context ? `Context: ${decision.context}` : null,
    decision.problem ? `Problem: ${decision.problem}` : null,
    decision.kind === "open_ended"
      ? `Answer: ${decision.outcome?.answer ?? "(decision is still open)"}`
      : chosen
        ? `Chosen option: ${chosen.title}${chosen.description ? ` — ${chosen.description}` : ""}`
        : "Chosen option: (decision is still open)",
    chosen?.consequences ? `Consequences: ${chosen.consequences}` : null,
    decision.outcome?.rationale ? `Rationale: ${decision.outcome.rationale}` : null,
    rejected.length > 0 ? `Rejected options: ${rejected.join(", ")}` : null,
    linked.length > 0 ? `Linked features: ${linked.join("; ")}` : null,
    created.length > 0 ? `Features created by this decision: ${created.join("; ")}` : null,
    decision.kind === "open_ended"
      ? "Implement the answer. Do not reopen the decision; raise a new decision through Konductor MCP if it proves unworkable."
      : "Implement the chosen option. Do not reopen the decision or pick another option; raise a new decision through Konductor MCP if it proves unworkable.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}
