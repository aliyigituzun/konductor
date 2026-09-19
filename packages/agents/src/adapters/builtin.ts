import type { AgentAdapterManifest } from "@konductor/schema";
import { AgentAdapterManifestSchema } from "@konductor/schema";

/**
 * Adapters that ship with Konductor.
 *
 * These are plain data: adding an agent needs a manifest, not a code change. Drop a
 * JSON file into ~/.konductor/adapters/ or <repo>/.konductor/adapters/ and it is
 * picked up alongside these.
 *
 * `verified` records whether the invocation flags were checked against the real CLI.
 * Unverified adapters still run, but `konductor doctor` and `konductor adapters
 * list` flag them, so a wrong flag reads as a known gap rather than a mystery.
 *
 * `providers` encodes which model providers a harness can drive. Claude Code, Codex
 * and Gemini CLI are each bound to their vendor; Pi and OpenCode route to several.
 * The model lists are catalogs for the picker — any model id a profile names is
 * passed through.
 *
 * On placeholders in `args`, see `resolveArgs` in ../invoke.ts.
 */
const MANIFESTS: unknown[] = [
  {
    id: "claude_code",
    title: "Claude Code",
    binary: "claude",
    homepage: "https://claude.com/claude-code",
    verified: true,
    detect: ["--version"],
    launch: { args: ["--model", "{{model}}"] },
    resume: { args: ["--resume", "{{session_id}}"] },
    providers: [
      {
        id: "anthropic",
        title: "Anthropic",
        models: [
          { id: "claude-fable-5-1", title: "Fable 5.1" },
          { id: "claude-opus-5", title: "Opus 5" },
          { id: "claude-sonnet-5", title: "Sonnet 5" },
          { id: "claude-haiku-4-5-20251001", title: "Haiku 4.5" },
        ],
      },
    ],
    model_format: "id",
    mcp: { kind: "mcp_json" },
    telemetry: { kind: "otel_env" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      // Claude Code renders permission prompts as a bordered numbered choice list.
      blocked: [
        // Every Claude Code choice dialog ends with this footer, whatever it is
        // asking — permission, first-run trust, or MCP server approval. Matching the
        // footer rather than each question keeps this from going stale.
        "Enter to confirm",
        "Do you want to proceed\\?",
        "Do you want to make this edit",
        "Yes, and don't ask again",
        "Is this a project you created or one you trust",
      ],
      // Printed only while a turn is in flight, and it sits in the same footer as
      // the idle marker below — which is exactly why it has to win.
      working: ["esc to interrupt"],
      // The permission-mode footer sits under the input box when Claude Code is
      // waiting for you.
      idle: ["shift\\+tab to cycle", "\\? for shortcuts"],
      done: [],
    },
  },
  {
    id: "codex",
    title: "OpenAI Codex CLI",
    binary: "codex",
    homepage: "https://github.com/openai/codex",
    // Flags written from published docs, not verified against the binary.
    verified: false,
    detect: ["--version"],
    launch: { args: ["--model", "{{model}}"] },
    resume: { args: ["resume", "{{session_id}}"] },
    providers: [
      {
        id: "openai",
        title: "OpenAI",
        models: [
          { id: "gpt-5.2-codex", title: "GPT-5.2 Codex" },
          { id: "gpt-5.1-codex", title: "GPT-5.1 Codex" },
          { id: "gpt-5-codex", title: "GPT-5 Codex" },
          { id: "gpt-5.1", title: "GPT-5.1" },
          { id: "gpt-5", title: "GPT-5" },
        ],
      },
    ],
    model_format: "id",
    mcp: { kind: "codex_toml" },
    telemetry: { kind: "none" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      blocked: ["Allow command\\?", "\\[y/n\\]", "Do you want to"],
      idle: ["send a message", "Ctrl\\+C to exit"],
      done: [],
    },
  },
  {
    id: "gemini_cli",
    title: "Gemini CLI",
    binary: "gemini",
    homepage: "https://github.com/google-gemini/gemini-cli",
    // Flags written from published docs, not verified against the binary.
    verified: false,
    detect: ["--version"],
    launch: { args: ["--model", "{{model}}"] },
    resume: null,
    providers: [
      {
        id: "google",
        title: "Google",
        models: [
          { id: "gemini-3-pro-preview", title: "Gemini 3 Pro" },
          { id: "gemini-2.5-pro", title: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", title: "Gemini 2.5 Flash" },
        ],
      },
    ],
    model_format: "id",
    mcp: { kind: "gemini_settings" },
    telemetry: { kind: "none" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      blocked: ["Allow execution", "Apply this change\\?", "\\(Y/n\\)", "Yes, allow"],
      idle: ["Type your message", "\\? for shortcuts"],
      done: [],
    },
  },
  {
    id: "pi",
    title: "Pi",
    binary: "pi",
    homepage: "https://pi.dev/",
    // Flags are taken from the official CLI reference, but the binary is not part
    // of Konductor's test environment, so this remains explicitly unverified.
    verified: false,
    detect: ["--version"],
    launch: { args: ["--provider", "{{provider}}", "--model", "{{model}}"] },
    resume: { args: ["--session", "{{session_id}}"] },
    providers: [
      {
        id: "anthropic",
        title: "Anthropic",
        models: [
          { id: "claude-fable-5-1", title: "Fable 5.1" },
          { id: "claude-opus-5", title: "Opus 5" },
          { id: "claude-sonnet-5", title: "Sonnet 5" },
          { id: "claude-haiku-4-5-20251001", title: "Haiku 4.5" },
        ],
      },
      {
        id: "openai",
        title: "OpenAI",
        models: [
          { id: "gpt-5.2-codex", title: "GPT-5.2 Codex" },
          { id: "gpt-5.1", title: "GPT-5.1" },
          { id: "gpt-5", title: "GPT-5" },
        ],
      },
      {
        id: "google",
        title: "Google Gemini",
        models: [
          { id: "gemini-3-pro-preview", title: "Gemini 3 Pro" },
          { id: "gemini-2.5-pro", title: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", title: "Gemini 2.5 Flash" },
        ],
      },
      { id: "openai-codex", title: "OpenAI Codex subscription", models: [] },
      { id: "github-copilot", title: "GitHub Copilot", models: [] },
      { id: "openrouter", title: "OpenRouter", models: [] },
      { id: "xai", title: "xAI", models: [] },
      { id: "radius", title: "Radius", models: [] },
      { id: "azure-openai-responses", title: "Azure OpenAI Responses", models: [] },
      { id: "amazon-bedrock", title: "Amazon Bedrock", models: [] },
      { id: "mistral", title: "Mistral", models: [] },
      { id: "deepseek", title: "DeepSeek", models: [] },
      { id: "groq", title: "Groq", models: [] },
      { id: "cerebras", title: "Cerebras", models: [] },
      { id: "nvidia", title: "NVIDIA NIM", models: [] },
      { id: "vercel-ai-gateway", title: "Vercel AI Gateway", models: [] },
      { id: "cloudflare-ai-gateway", title: "Cloudflare AI Gateway", models: [] },
      { id: "cloudflare-workers-ai", title: "Cloudflare Workers AI", models: [] },
      { id: "opencode", title: "OpenCode Zen", models: [] },
      { id: "opencode-go", title: "OpenCode Go", models: [] },
      { id: "zai", title: "ZAI Coding Plan", models: [] },
      { id: "zai-coding-cn", title: "ZAI Coding Plan (China)", models: [] },
      { id: "kimi-coding", title: "Kimi For Coding", models: [] },
      { id: "huggingface", title: "Hugging Face", models: [] },
      { id: "fireworks", title: "Fireworks", models: [] },
      { id: "together", title: "Together AI", models: [] },
      { id: "baseten", title: "Baseten", models: [] },
      { id: "ant-ling", title: "Ant Ling", models: [] },
      { id: "minimax", title: "MiniMax", models: [] },
      { id: "minimax-cn", title: "MiniMax (China)", models: [] },
      { id: "qwen-token-plan", title: "Qwen Token Plan", models: [] },
      { id: "qwen-token-plan-individual", title: "Qwen Token Plan (Individual)", models: [] },
      { id: "qwen-token-plan-cn", title: "Qwen Token Plan (China)", models: [] },
      { id: "xiaomi", title: "Xiaomi MiMo", models: [] },
      { id: "xiaomi-token-plan-cn", title: "Xiaomi MiMo Token Plan (China)", models: [] },
      { id: "xiaomi-token-plan-ams", title: "Xiaomi MiMo Token Plan (Amsterdam)", models: [] },
      { id: "xiaomi-token-plan-sgp", title: "Xiaomi MiMo Token Plan (Singapore)", models: [] },
    ],
    model_format: "id",
    // Installed into Konductor's isolated Pi home by `konductor adapters setup pi`.
    mcp: { kind: "pi_mcp_json" },
    telemetry: { kind: "none" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      // Pi has no built-in permission popups.
      blocked: [],
      // The built-in editor border shows this only while a turn is active.
      working: ["\\bWorking\\b"],
      // The stable footer always includes context usage (for example 4.2%/200k).
      idle: ["(?:\\?|\\d+(?:\\.\\d+)?%)/\\d+(?:\\.\\d+)?[kM]?"],
      done: [],
    },
  },
  {
    id: "opencode",
    title: "OpenCode",
    binary: "opencode",
    homepage: "https://opencode.ai",
    // Flags written from published docs, not verified against the binary.
    verified: false,
    detect: ["--version"],
    launch: { args: ["--model", "{{model}}"] },
    resume: { args: ["--session", "{{session_id}}"] },
    providers: [
      {
        id: "anthropic",
        title: "Anthropic",
        models: [
          { id: "claude-fable-5-1", title: "Fable 5.1" },
          { id: "claude-opus-5", title: "Opus 5" },
          { id: "claude-sonnet-5", title: "Sonnet 5" },
          { id: "claude-haiku-4-5-20251001", title: "Haiku 4.5" },
        ],
      },
      {
        id: "openai",
        title: "OpenAI",
        models: [
          { id: "gpt-5.2-codex", title: "GPT-5.2 Codex" },
          { id: "gpt-5.1", title: "GPT-5.1" },
          { id: "gpt-5", title: "GPT-5" },
        ],
      },
      {
        id: "google",
        title: "Google",
        models: [
          { id: "gemini-3-pro-preview", title: "Gemini 3 Pro" },
          { id: "gemini-2.5-pro", title: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", title: "Gemini 2.5 Flash" },
        ],
      },
      { id: "openrouter", title: "OpenRouter", models: [] },
      { id: "ollama", title: "Ollama (local)", models: [] },
    ],
    model_format: "provider/id",
    mcp: { kind: "opencode_json" },
    telemetry: { kind: "none" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      blocked: ["permission", "Allow\\?", "\\[y/n\\]"],
      idle: ["ctrl\\+c", "/help"],
      done: [],
    },
  },
];

export function builtinAdapters(): AgentAdapterManifest[] {
  return MANIFESTS.map((raw) => AgentAdapterManifestSchema.parse(raw));
}
