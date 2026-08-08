/**
 * Long-term memory layer for the autonomous agent.
 *
 * Breeth (BREETH_API_URL + BREETH_API_KEY, server-side only) is Ada's
 * persistent long-term memory. The project database stays the operational
 * persistence layer and the fallback whenever Breeth is unreachable.
 *
 * Neither secret is ever imported into client code: this module is a
 * `.server.ts` file and is only reached from server handlers.
 */

export type MemoryItem = {
  topic: string;
  summary?: string | null;
  insights?: string[];
  rationale?: string | null;
  createdAt?: string | null;
  source: "database" | "breeth";
};

export type MemoryEntry = {
  topic: string;
  summary?: string;
  insights?: string[];
  decision?: string;
  rationale?: string;
  sources?: string[];
  postId?: string;
  publishedAt?: string;
};

function breethConfig() {
  const url = process.env["BREETH_API_URL"];
  const key = process.env["BREETH_API_KEY"];
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function breethConfigured() {
  return breethConfig() !== null;
}

async function breethFetch(
  path: string,
  body: unknown,
  cfg: { url: string; key: string },
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
        "X-API-Key": cfg.key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON response */
    }
    return { ok: res.ok, status: res.status, json: parsed, text };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeItems(payload: unknown): MemoryItem[] {
  const root = payload as Record<string, unknown> | null;
  const rawList =
    (Array.isArray(root?.["items"]) && root["items"]) ||
    (Array.isArray(root?.["memories"]) && root["memories"]) ||
    (Array.isArray(root?.["results"]) && root["results"]) ||
    (Array.isArray(root?.["data"]) && root["data"]) ||
    (Array.isArray(payload) ? payload : []);

  return (rawList as Record<string, unknown>[])
    .map((i) => {
      const meta = (i?.["metadata"] as Record<string, unknown>) ?? {};
      const topic =
        (i?.["topic"] as string) ??
        (meta["topic"] as string) ??
        (i?.["title"] as string) ??
        (typeof i?.["content"] === "string" ? (i["content"] as string).slice(0, 160) : "") ??
        (typeof i?.["text"] === "string" ? (i["text"] as string).slice(0, 160) : "");
      const insights = i?.["insights"] ?? meta["insights"];
      return {
        topic: String(topic ?? "").trim(),
        summary: (i?.["summary"] as string) ?? (meta["summary"] as string) ?? null,
        insights: Array.isArray(insights) ? insights.map(String).slice(0, 8) : [],
        rationale: (i?.["rationale"] as string) ?? (meta["rationale"] as string) ?? null,
        createdAt:
          (i?.["created_at"] as string) ??
          (i?.["createdAt"] as string) ??
          (meta["published_at"] as string) ??
          null,
        source: "breeth" as const,
      };
    })
    .filter((i) => i.topic.length > 0);
}

/** Search Breeth for previously published topics and relevant memories. */
export async function breethRecall(namespace: string, query: string): Promise<MemoryItem[]> {
  const cfg = breethConfig();
  if (!cfg) return [];

  const payload = { namespace, query, limit: 25, top_k: 25 };
  for (const path of ["/recall", "/search", "/memories/search", "/v1/memories/search"]) {
    try {
      const res = await breethFetch(path, payload, cfg);
      if (res.ok) {
        const items = normalizeItems(res.json);
        if (items.length || path === "/recall") return items;
        continue;
      }
      if (res.status === 404 || res.status === 405) continue; // try next shape
      console.error(`Breeth recall failed [${res.status}] on ${path}: ${res.text.slice(0, 300)}`);
      return [];
    } catch (err) {
      console.error("Breeth recall error:", err instanceof Error ? err.message : err);
      return [];
    }
  }
  return [];
}

/** Persist the published topic, insights, decision and rationale into Breeth. */
export async function breethRemember(namespace: string, entry: MemoryEntry): Promise<boolean> {
  const cfg = breethConfig();
  if (!cfg) return false;

  const publishedAt = entry.publishedAt ?? new Date().toISOString();
  const content = [
    `Topic: ${entry.topic}`,
    entry.summary ? `Summary: ${entry.summary}` : "",
    entry.insights?.length ? `Key facts: ${entry.insights.join(" | ")}` : "",
    entry.decision ? `Editorial decision: ${entry.decision}` : "",
    entry.rationale ? `Rationale: ${entry.rationale}` : "",
    entry.sources?.length ? `Sources: ${entry.sources.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    namespace,
    topic: entry.topic,
    summary: entry.summary ?? null,
    insights: entry.insights ?? [],
    decision: entry.decision ?? "published",
    rationale: entry.rationale ?? null,
    sources: entry.sources ?? [],
    post_id: entry.postId ?? null,
    published_at: publishedAt,
    content,
    text: content,
    metadata: {
      topic: entry.topic,
      summary: entry.summary ?? null,
      insights: entry.insights ?? [],
      decision: entry.decision ?? "published",
      rationale: entry.rationale ?? null,
      sources: entry.sources ?? [],
      post_id: entry.postId ?? null,
      published_at: publishedAt,
    },
  };

  for (const path of ["/remember", "/memories", "/v1/memories", "/store"]) {
    try {
      const res = await breethFetch(path, payload, cfg);
      if (res.ok) return true;
      if (res.status === 404 || res.status === 405) continue;
      console.error(`Breeth remember failed [${res.status}] on ${path}: ${res.text.slice(0, 300)}`);
      return false;
    } catch (err) {
      console.error("Breeth remember error:", err instanceof Error ? err.message : err);
      return false;
    }
  }
  return false;
}

/** Connectivity probe used by the diagnostics endpoint. Never returns secrets. */
export async function breethHealth(namespace = "diagnostics") {
  const cfg = breethConfig();
  if (!cfg) return { configured: false, read: false, write: false, note: "BREETH_API_URL / BREETH_API_KEY not set" };
  const probe = `breeth connectivity probe ${new Date().toISOString()}`;
  const write = await breethRemember(namespace, {
    topic: probe,
    summary: "Connectivity probe written by Ada's memory layer.",
    insights: ["probe"],
    decision: "probe",
    rationale: "Verifying Breeth write access.",
  });
  const items = await breethRecall(namespace, "breeth connectivity probe");
  return {
    configured: true,
    write,
    read: items.length > 0,
    recalled: items.slice(0, 5).map((i) => i.topic),
  };
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
