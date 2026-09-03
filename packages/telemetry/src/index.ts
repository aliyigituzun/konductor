export * from "./adapter.js";
export * from "./signals.js";

/** Absolute path to the receiver script — use to spawn the daemon */
export const RECEIVER_SCRIPT = new URL("./receiver.ts", import.meta.url).pathname;
