/** Soft open-file limit the long-lived Konductor processes are started with. */
export const MIN_OPEN_FILES = 1024;

/**
 * Wraps a command so it runs with at least MIN_OPEN_FILES file descriptors.
 *
 * macOS starts shells with a soft limit of 256, which Vite's watcher and Bun
 * exhaust; the symptom is an endless "low max file descriptors" log and a
 * server that never binds its port. Bun has no setrlimit, so the limit is
 * raised in a POSIX shell before exec. Raising the soft limit up to the hard
 * limit needs no privileges; if it still fails the command runs as before.
 */
export function withOpenFileLimit(command: string[]): string[] {
  const script = `[ "$(ulimit -n)" -ge ${MIN_OPEN_FILES} ] 2>/dev/null || ulimit -n ${MIN_OPEN_FILES} 2>/dev/null; exec "$@"`;
  return ["sh", "-c", script, "sh", ...command];
}
