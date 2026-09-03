import type { AgentAdapterManifest, AgentMode, AgentProfile } from "@konductor/schema";

export type InvocationValues = {
  prompt?: string | undefined;
  model?: string | undefined;
  session_id?: string | undefined;
  task_file?: string | undefined;
};

const PLACEHOLDER = /^\{\{([a-z_]+)\}\}$/;

/**
 * Substitute `{{placeholder}}` tokens in an adapter's argv.
 *
 * A placeholder with no value drops its own token, and also the token before it when
 * that token is a flag. This is what lets one manifest express an optional flag pair
 * positionally — `["exec", "--model", "{{model}}", "{{prompt}}"]` becomes
 * `["exec", "<prompt>"]` when the profile pins no model, without the manifest
 * needing to know where in the argv the flag belongs.
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

/**
 * Build the argv for launching an agent.
 *
 * Profile `args` are appended after the adapter's own arguments so a project can add
 * flags without having to restate the adapter's invocation.
 */
export function buildArgv(
  manifest: AgentAdapterManifest,
  profile: Pick<AgentProfile, "args" | "binary" | "model">,
  mode: AgentMode,
  values: InvocationValues = {},
): string[] {
  const invocation = mode === "pane" ? manifest.interactive : manifest.headless;
  if (!invocation) {
    throw new AdapterInvocationError(
      `Adapter "${manifest.id}" has no ${mode === "pane" ? "interactive" : "headless"} mode. ` +
        `Choose the other mode for this profile.`,
    );
  }
  if (mode === "headless" && !values.prompt) {
    throw new AdapterInvocationError("A headless run needs a prompt.");
  }

  const binary = profile.binary ?? manifest.binary;
  const resolved = resolveArgs(invocation.args, {
    ...values,
    model: values.model ?? profile.model,
  });
  return [binary, ...resolved, ...profile.args];
}

/** Argv that resumes a previous session, or null when the adapter cannot resume. */
export function buildResumeArgv(
  manifest: AgentAdapterManifest,
  profile: Pick<AgentProfile, "args" | "binary" | "model">,
  sessionId: string,
): string[] | null {
  if (!manifest.resume) return null;
  const binary = profile.binary ?? manifest.binary;
  const resolved = resolveArgs(manifest.resume.args, {
    session_id: sessionId,
    model: profile.model,
  });
  return [binary, ...resolved, ...profile.args];
}
