import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  ProjectTokensFileSchema,
  type ProjectToken,
  type ProjectTokensFile,
  type TokenProvider,
} from "@konductor/schema";
import { repoLocal } from "./paths.js";

export function normalizeProjectTokens(raw: unknown): ProjectTokensFile {
  const data = (raw ?? {}) as { tokens?: ProjectToken[] };
  return ProjectTokensFileSchema.parse({
    schema_version: "0.2.0",
    tokens: data.tokens ?? [],
  });
}

export async function readProjectTokens(cwd: string): Promise<ProjectTokensFile> {
  const file = repoLocal(cwd).tokensFile;
  if (!existsSync(file)) {
    return { schema_version: "0.2.0", tokens: [] };
  }
  const raw = await readFile(file, "utf-8");
  return normalizeProjectTokens(JSON.parse(raw));
}

export async function writeProjectTokens(cwd: string, tokens: ProjectTokensFile): Promise<void> {
  const repo = repoLocal(cwd);
  await mkdir(repo.dir, { recursive: true });
  await writeFile(
    repo.tokensFile,
    JSON.stringify(ProjectTokensFileSchema.parse(tokens), null, 2),
    "utf-8",
  );
}

export function findProjectToken(
  tokensFile: ProjectTokensFile,
  tokenId: string | null | undefined,
): ProjectToken | null {
  if (!tokenId) return null;
  return tokensFile.tokens.find((token) => token.id === tokenId) ?? null;
}

export function validateTokenProvider(
  token: Pick<ProjectToken, "provider"> | null,
  provider: TokenProvider,
): string | null {
  if (!token) return "Selected token was not found.";
  if (token.provider !== provider) {
    return `Selected token provider (${token.provider}) does not match agent provider (${provider}).`;
  }
  return null;
}
