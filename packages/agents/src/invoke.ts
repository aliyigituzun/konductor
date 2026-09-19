import type { AdapterProvider, AgentAdapterManifest, AgentProfile } from "@konductor/schema";

export type InvocationValues = {
  provider?: string | undefined;
  model?: string | undefined;
  session_id?: string | undefined;
  task_file?: string | undefined;
};

const PLACEHOLDER = /^\{\{([a-z_]+)\}\}$/;

const CLAUDE_PARENT_SESSION_KEYS = new Set([
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
]);

/**
 * Build a clean child environment for a harness process.
 *
 * The host can itself be started from inside an agent terminal. Claude Code marks
 * that parent session with variables that make a newly launched Claude process look
 * recursively nested, so those transient markers must not cross the supervisor
 * boundary. Runtime/profile overrides are applied afterwards and undefined values
 * are omitted instead of becoming the literal string "undefined" in tmux.
 */
export function buildHarnessEnv(
  manifest: Pick<AgentAdapterManifest, "id">,
  base: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (manifest.id === "claude_code" && CLAUDE_PARENT_SESSION_KEYS.has(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/**
 * Substitute `{{placeholder}}` tokens in an adapter's argv.
 *
 * A placeholder with no value drops its own token, and also the token before it when
 * that token is a flag. This is what lets one manifest express an optional flag pair
 * positionally — `["--model", "{{model}}", "--verbose"]` becomes `["--verbose"]`
 * when the profile pins no model, without the manifest needing to know where in the
 * argv the flag belongs.
 */
export function resolveArgs(args: string[], values: InvocationValues): string[] {
  const out: string[] = [];
  for (const arg of args) {
    const match = PLACEHOLDER.exec(arg);
    if (!match) {
      out.push(arg);
      continue;
    }
    const key = match[1] as keyof InvocationValues;
    const value = values[key];
    if (value === undefined || value === "") {
      // Drop the flag this placeholder was the value for.
      const previous = out[out.length - 1];
      if (previous !== undefined && previous.startsWith("-")) out.pop();
      continue;
    }
    out.push(value);
  }
  return out;
}

export class AdapterInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterInvocationError";
  }
}

/** The provider and model an agent will actually be launched with. */
export type ModelSelection = {
  provider: AdapterProvider;
  /** Model id as the profile named it; null when the harness default is used. */
  model: string | null;
  /** What goes into `{{model}}`, formatted per the manifest; null for the default. */
  argument: string | null;
};

/**
 * Resolve which provider and model a profile means for a manifest.
 *
 * The manifest is the authority on what a harness can talk to. A single-provider
 * harness ignores nothing: naming any other provider is an error rather than a
 * silent fallback, because the operator would otherwise believe they were running
 * on a vendor the CLI cannot reach. The model itself is passed through — catalogs
 * lag behind what providers ship, so an unlisted model is not an error here.
 */
export function resolveModel(
  manifest: AgentAdapterManifest,
  profile: Pick<AgentProfile, "provider" | "model">,
  overrides: { provider?: string | undefined; model?: string | undefined } = {},
): ModelSelection {
  const providerId = overrides.provider?.trim() || profile.provider?.trim() || null;
  const model = overrides.model?.trim() || profile.model?.trim() || null;

  const provider = providerId
    ? manifest.providers.find((candidate) => candidate.id === providerId)
    : manifest.providers[0];

  if (!provider) {
    const known = manifest.providers.map((candidate) => candidate.id).join(", ");
    throw new AdapterInvocationError(
      manifest.providers.length === 1
        ? `${manifest.title} only runs on ${manifest.providers[0]!.title} (provider "${known}"); ` +
            `it cannot use provider "${providerId}".`
        : `${manifest.title} does not support provider "${providerId}". Choose one of: ${known}.`,
    );
  }

  if (!model) return { provider, model: null, argument: null };

  const argument = manifest.model_format === "provider/id" ? `${provider.id}/${model}` : model;
  return { provider, model, argument };
}

/**
 * Build the argv that opens an agent in its pane.
 *
 * Profile `args` are appended after the adapter's own arguments so a project can add
 * flags without having to restate the adapter's invocation.
 */
export function buildArgv(
  manifest: AgentAdapterManifest,
  profile: Pick<AgentProfile, "args" | "binary">,
  values: InvocationValues = {},
  runtimeArgs: string[] = [],
): string[] {
  const binary = profile.binary ?? manifest.binary;
  return [binary, ...resolveArgs(manifest.launch.args, values), ...runtimeArgs, ...profile.args];
}

/** Argv that resumes a previous session, or null when the adapter cannot resume. */
export function buildResumeArgv(
  manifest: AgentAdapterManifest,
  profile: Pick<AgentProfile, "args" | "binary">,
  sessionId: string,
  values: Omit<InvocationValues, "session_id"> = {},
): string[] | null {
  if (!manifest.resume) return null;
  const binary = profile.binary ?? manifest.binary;
  const resolved = resolveArgs(manifest.resume.args, { ...values, session_id: sessionId });
  return [binary, ...resolved, ...profile.args];
}
