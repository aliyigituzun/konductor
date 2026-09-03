import { fileURLToPath } from "node:url";

export const HOST_SERVER_SCRIPT = fileURLToPath(new URL("./server.ts", import.meta.url));
export const DEFAULT_HOST_PORT = 4096;

export function hostBaseUrl(port: number = DEFAULT_HOST_PORT): string {
  return `http://127.0.0.1:${port}`;
}
