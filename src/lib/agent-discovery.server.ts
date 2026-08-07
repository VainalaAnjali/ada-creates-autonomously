/**
 * DISCOVER step: retrieve current AI / technology topics from live sources.
 * No API keys required, so discovery keeps working in any environment.
 * Failures throw — the scheduler must never invent fake material.
 */

export type Candidate = {
  topic: string;
  summary: string;
  url: string;
  sourceTitle: string;
  points: number;
  publishedAt: string | null;
};

const QUERIES = [
  "artificial intelligence",
  "LLM",
  "machine learning",
  "AI chips",
  "AI agents",
  "open source model",
];

const AI_TERMS = [
  "ai", "artificial intelligence", "llm", "model", "gpt", "claude", "gemini", "llama",
  "machine learning", "neural", "transformer", "inference", "gpu", "chip", "nvidia",
  "agent", "robot", "diffusion", "dataset", "training", "openai", "anthropic",
  "deepmind", "compute", "semiconductor", "software", "developer", "programming",
];

function isRelevant(title: string): boolean {
  const t = title.toLowerCase();
  return AI_TERMS.some((term) => t.includes(term));
}

async function fetchHackerNews(query: string): Promise<Candidate[]> {
  const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
    `&tags=story&numericFilters=created_at_i>${since},points>15&hitsPerPage=20`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Discovery source failed [${res.status}]: ${await res.text()}`);
  const body = (await res.json()) as {
    hits?: {
      title?: string;
      url?: string | null;
      story_text?: string | null;
      points?: number;
      created_at?: string;
      objectID?: string;
    }[];
  };
  return (body.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      topic: String(h.title),
      summary: (h.story_text ?? "").replace(/<[^>]+>/g, "").slice(0, 400),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      sourceTitle: String(h.title),
      points: h.points ?? 0,
      publishedAt: h.created_at ?? null,
    }));
}

async function fetchArxiv(): Promise<Candidate[]> {
  const url =
    "https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG" +
    "&sortBy=submittedDate&sortOrder=descending&max_results=15";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`arXiv discovery failed [${res.status}]`);
  const xml = await res.text();
  const entries = xml.split("<entry>").slice(1);
  return entries
    .map((entry) => {
      const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1]?.replace(/\s+/g, " ").trim();
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1]?.replace(/\s+/g, " ").trim();
      const link = /<id>([\s\S]*?)<\/id>/.exec(entry)?.[1]?.trim();
      const published = /<published>([\s\S]*?)<\/published>/.exec(entry)?.[1]?.trim() ?? null;
      if (!title || !link) return null;
      return {
        topic: title,
        summary: (summary ?? "").slice(0, 500),
        url: link,
        sourceTitle: `arXiv: ${title}`,
        points: 20,
        publishedAt: published,
      } satisfies Candidate;
    })
    .filter((c): c is Candidate => c !== null);
}

/** Returns deduplicated, AI/tech-relevant candidates from live sources. */
export async function discoverTopics(): Promise<Candidate[]> {
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)]!;
  const settled = await Promise.allSettled([fetchHackerNews(query), fetchArxiv()]);

  const failures: string[] = [];
  const all: Candidate[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") all.push(...r.value);
    else failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  if (!all.length) {
    throw new Error(
      `Topic discovery returned no live results${failures.length ? `: ${failures.join("; ")}` : ""}`,
    );
  }

  const seen = new Set<string>();
  return all
    .filter((c) => isRelevant(c.topic))
    .filter((c) => {
      const key = c.topic.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.points - a.points)
    .slice(0, 12);
}
