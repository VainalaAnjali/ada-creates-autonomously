/**
 * Memory layer for the autonomous agent.
 *
 * Primary store is always the project database (durable, insert-only history).
 * If an external memory service ("Breeth") is configured through the
 * BREETH_API_URL / BREETH_API_KEY server secrets, it is used as an additional
 * recall + write-through layer. Any failure there is logged and ignored: the
 * database history is the fallback for duplicate detection.
 */

export type MemoryItem = {
  topic: string;
  summary?: string | null;
  createdAt?: string | null;
  source: "database" | "breeth";
};

function breethConfig() {
  const url = process.env["BREETH_API_URL"];
  const key = process.env["BREETH_API_KEY"];
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export async function breethRecall(namespace: string, query: string): Promise<MemoryItem[]> {
  const cfg = breethConfig();
  if (!cfg) return [];
  try {
    const res = await fetch(`${cfg.url}/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ namespace, query, limit: 25 }),
    });
    if (!res.ok) {
      console.error(`Breeth recall failed [${res.status}]: ${await res.text()}`);
      return [];
    }
    const body = (await res.json()) as { items?: { topic?: string; summary?: string; created_at?: string }[] };
    return (body.items ?? [])
      .filter((i) => i.topic)
      .map((i) => ({
        topic: String(i.topic),
        summary: i.summary ?? null,
        createdAt: i.created_at ?? null,
        source: "breeth" as const,
      }));
  } catch (err) {
    console.error("Breeth recall error:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function breethRemember(
  namespace: string,
  entry: { topic: string; summary?: string; rationale?: string; sources?: string[]; postId?: string },
): Promise<boolean> {
  const cfg = breethConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.url}/remember`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ namespace, ...entry }),
    });
    if (!res.ok) {
      console.error(`Breeth remember failed [${res.status}]: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Breeth remember error:", err instanceof Error ? err.message : err);
    return false;
  }
}

export function breethConfigured() {
  return breethConfig() !== null;
}

/** Cheap lexical similarity used for local duplicate detection. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "is", "are", "with", "how",
  "why", "what", "new", "ai", "its", "it", "that", "this", "from", "by", "at", "as", "be",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}
