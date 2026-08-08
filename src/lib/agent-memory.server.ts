/**
 * Long-term memory layer for the autonomous agent (Breeth / cogram-core).
 *
 * Breeth (BREETH_API_URL + BREETH_API_KEY, server-side only) is Ada's
 * persistent long-term memory:
 *   - recall  -> POST /v1/search   (graph facts for a query, scoped by group_id)
 *   - remember-> POST /v1/episodes (prose episode) + POST /v1/facts (triples)
 *
 * The project database remains the operational persistence layer and the
 * fallback whenever Breeth is unavailable. Neither secret is ever exposed to
 * the frontend: this is a `.server.ts` module reached only from server code.
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

/** Breeth group ids are short labels; derive a stable one per agent. */
export function memoryGroup(namespace: string): string {
  const slug = namespace.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `ada-${slug.slice(-24) || "default"}`;
}

async function breethPost(
  path: string,
  body: unknown,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; status: number; json: unknown; text: string } | null> {
  const cfg = breethConfig();
  if (!cfg) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    if (!res.ok) console.error(`Breeth ${path} failed [${res.status}]: ${text.slice(0, 300)}`);
    return { ok: res.ok, status: res.status, json: parsed, text };
  } catch (err) {
    console.error(`Breeth ${path} error:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Search Breeth for previously published topics and relevant memories. */
export async function breethRecall(namespace: string, query: string): Promise<MemoryItem[]> {
  if (!breethConfigured()) return [];
  const res = await breethPost("/v1/search", {
    query: query.slice(0, 1000),
    group_id: memoryGroup(namespace),
    limit: 25,
  });
  if (!res?.ok) return [];

  const edges = ((res.json as { edges?: unknown[] } | null)?.edges ?? []) as Record<string, unknown>[];
  const seen = new Set<string>();
  const items: MemoryItem[] = [];
  for (const e of edges) {
    const fact = String(e?.["fact"] ?? e?.["name"] ?? "").trim();
    if (!fact || seen.has(fact.toLowerCase())) continue;
    seen.add(fact.toLowerCase());
    items.push({ topic: fact, summary: null, insights: [], rationale: null, createdAt: null, source: "breeth" });
  }
  return items;
}

/** Store the published topic, key facts, decision and rationale in Breeth. */
export async function breethRemember(namespace: string, entry: MemoryEntry): Promise<boolean> {
  if (!breethConfigured()) return false;
  const group = memoryGroup(namespace);
  const publishedAt = entry.publishedAt ?? new Date().toISOString();

  const content = [
    `On ${publishedAt}, Ada published a post about: ${entry.topic}.`,
    entry.summary ? `Summary: ${entry.summary}` : "",
    entry.insights?.length ? `Key facts and insights: ${entry.insights.join(" ")}` : "",
    entry.decision ? `Editorial decision: ${entry.decision}.` : "",
    entry.rationale ? `Publishing rationale: ${entry.rationale}` : "",
    entry.sources?.length ? `Sources: ${entry.sources.join(" , ")}` : "",
    entry.postId ? `Post id: ${entry.postId}.` : "",
    `Ada has already covered this topic and must not repeat it.`,
  ]
    .filter(Boolean)
    .join("\n");

  const episode = await breethPost("/v1/episodes", {
    content,
    group_id: group,
    source_description: "ada-autonomous-cycle",
  });
  const okEpisode = Boolean(episode?.ok);

  // Explicit triples make duplicate lookups sharp even before narration settles.
  const triples = [
    { subject: "Ada", predicate: "already published about", object: entry.topic.slice(0, 240) },
    ...(entry.decision
      ? [{ subject: entry.topic.slice(0, 240), predicate: "editorial decision", object: entry.decision.slice(0, 240) }]
      : []),
    ...(entry.rationale
      ? [{ subject: entry.topic.slice(0, 240), predicate: "published because", object: entry.rationale.slice(0, 240) }]
      : []),
    ...(entry.insights ?? [])
      .slice(0, 3)
      .map((i) => ({ subject: entry.topic.slice(0, 240), predicate: "key insight", object: String(i).slice(0, 240) })),
  ];
  await Promise.all(triples.map((t) => breethPost("/v1/facts", { ...t, group_id: group })));

  return okEpisode;
}

/** Connectivity probe used by the diagnostics endpoint. Never returns secrets. */
export async function breethHealth(namespace = "diagnostics") {
  if (!breethConfigured()) {
    return { configured: false, read: false, write: false, note: "BREETH_API_URL / BREETH_API_KEY not set" };
  }
  const marker = `Breeth connectivity probe ${Date.now()}`;
  const write = await breethRemember(namespace, {
    topic: marker,
    summary: "Connectivity probe written by Ada's memory layer.",
    insights: ["Breeth write path is reachable."],
    decision: "probe",
    rationale: "Verifying Breeth read/write access.",
  });
  const items = await breethRecall(namespace, marker);
  return {
    configured: true,
    group: memoryGroup(namespace),
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
