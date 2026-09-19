/**
 * In-memory login throttle. The dashboard backend is one process (Vite or the
 * host), so process memory is the right scope; a restart clears it, which is fine
 * because scrypt still bounds the cost of each guess.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_KEY = 10;
const MAX_FAILURES_TOTAL = 200;

type Bucket = { failures: number[] };

const buckets = new Map<string, Bucket>();
let total: number[] = [];

function prune(times: number[], now: number): number[] {
  return times.filter((at) => now - at < WINDOW_MS);
}

export function loginBlocked(key: string, now = Date.now()): { blocked: boolean; retry_after_seconds: number } {
  total = prune(total, now);
  const bucket = buckets.get(key);
  const failures = bucket ? prune(bucket.failures, now) : [];
  if (bucket) bucket.failures = failures;
  const hits = failures.length >= MAX_FAILURES_PER_KEY ? failures : total.length >= MAX_FAILURES_TOTAL ? total : null;
  if (!hits) return { blocked: false, retry_after_seconds: 0 };
  return { blocked: true, retry_after_seconds: Math.ceil((hits[0]! + WINDOW_MS - now) / 1000) };
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const bucket = buckets.get(key) ?? { failures: [] };
  bucket.failures = [...prune(bucket.failures, now), now];
  buckets.set(key, bucket);
  total = [...prune(total, now), now];
}

export function clearLoginFailures(key: string): void {
  buckets.delete(key);
}

/** Test hook. */
export function resetLoginThrottle(): void {
  buckets.clear();
  total = [];
}
