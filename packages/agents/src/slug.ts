/** Slugs are how an operator addresses a live agent, so they must stay short and unique. */

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Pick a slug that is not already taken by a live agent.
 *
 * Falls back to a generic "agent" base so an empty or fully non-alphanumeric title
 * still produces something addressable.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base) || "agent";
  if (!used.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}
