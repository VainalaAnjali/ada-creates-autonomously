import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const ADA_CONFIG = {
  name: "Ada",
  domain: "AI & Technology",
  persona:
    "Ada is an autonomous AI technology creator. She publishes sharp, credible, non-hyped insights about artificial intelligence, machine learning systems, developer tooling, chips, and the technology industry. She writes with clarity, cites where ideas come from, and always explains why a topic matters right now.",
  interval_seconds: 120,
  model: "google/gemini-3.6-flash",
};

const TOPIC_SEEDS = [
  "frontier model releases and what changed under the hood",
  "AI agents and tool-use architectures in production",
  "inference cost, quantization and serving efficiency",
  "retrieval augmented generation and context engineering",
  "AI chips, accelerators and datacenter buildout",
  "open-weight models vs closed APIs",
  "evaluation, benchmarks and why they mislead",
  "AI safety, alignment and model governance",
  "developer tooling and AI-assisted software engineering",
  "multimodal models: video, audio and robotics",
  "small language models on the edge",
  "AI regulation and policy shifts",
  "vector databases and memory systems",
  "synthetic data and training pipelines",
  "the economics of AI startups",
];

export function getServiceClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Backend database credentials are not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AgentRow = {
  id: string;
  name: string;
  domain: string;
  persona: string;
  status: string;
  autonomous: boolean;
  interval_seconds: number;
  next_run_at: string;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  config: Record<string, unknown>;
};

/** Creates the Ada agent if it does not exist yet, otherwise returns the existing one. */
export async function initAgent(overrides?: Partial<typeof ADA_CONFIG>) {
  const db = getServiceClient();
  const cfg = { ...ADA_CONFIG, ...overrides };

  const { data: existing } = await db
    .from("agents")
    .select("*")
    .eq("name", cfg.name)
    .maybeSingle();

  if (existing) return { agent: existing as AgentRow, created: false };

  const { data, error } = await db
    .from("agents")
    .insert({
      name: cfg.name,
      domain: cfg.domain,
      persona: cfg.persona,
      interval_seconds: cfg.interval_seconds,
      autonomous: true,
      status: "active",
      next_run_at: new Date().toISOString(),
      config: { model: cfg.model, topics: TOPIC_SEEDS },
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return { agent: data as AgentRow, created: true };
}

type GeneratedPost = {
  title: string;
  content: string;
  summary: string;
  rationale: string;
  topic: string;
  tags: string[];
  sources: { title: string; url: string }[];
};

async function generatePost(agent: AgentRow, recentTitles: string[]): Promise<GeneratedPost> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI credentials are not configured");

  const model = (agent.config?.["model"] as string) ?? ADA_CONFIG.model;
  const seed = TOPIC_SEEDS[Math.floor(Math.random() * TOPIC_SEEDS.length)];

  const system = `${agent.persona}\nYou write standalone posts for the domain "${agent.domain}". Reply with JSON only.`;
  const user = `Write one new original post.
Angle to explore this cycle: ${seed}.
Avoid repeating these recent titles: ${recentTitles.length ? recentTitles.join(" | ") : "(none yet)"}.

Return a JSON object with exactly these keys:
"title" (max 90 chars, specific, no clickbait),
"content" (300-450 words of markdown-free prose in 3-4 short paragraphs),
"summary" (one sentence),
"rationale" (2-3 sentences explaining WHY you chose to publish this now, as the autonomous creator),
"topic" (short topic label),
"tags" (array of 3-5 lowercase tags),
"sources" (array of 2-4 objects with "title" and "url", using real, well-known, stable reference URLs such as official docs, arxiv, or major tech publications).`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI request failed [${res.status}]: ${body}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned) as GeneratedPost;

  if (!parsed.title || !parsed.content) throw new Error("AI returned an incomplete post");
  return {
    title: String(parsed.title).slice(0, 200),
    content: String(parsed.content),
    summary: String(parsed.summary ?? ""),
    rationale: String(parsed.rationale ?? ""),
    topic: String(parsed.topic ?? seed),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : [],
    sources: Array.isArray(parsed.sources)
      ? parsed.sources
          .filter((s) => s && typeof s === "object" && s.url)
          .map((s) => ({ title: String(s.title ?? s.url), url: String(s.url) }))
          .slice(0, 5)
      : [],
  };
}

/**
 * Runs one autonomous cycle for every agent whose schedule is due.
 * Safe to call from cron or opportunistically from a read endpoint.
 */
export async function runDueAgents(trigger: string) {
  const db = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await db
    .from("agents")
    .select("*")
    .eq("autonomous", true)
    .eq("status", "active")
    .lte("next_run_at", nowIso);

  const results: { agentId: string; status: string }[] = [];
  for (const agent of (due ?? []) as AgentRow[]) {
    results.push({ agentId: agent.id, status: await runAgentOnce(agent, trigger) });
  }
  return results;
}

export async function runAgentOnce(agent: AgentRow, trigger: string): Promise<string> {
  const db = getServiceClient();
  const started = Date.now();

  // Claim the slot first so concurrent callers cannot double-publish.
  const nextRun = new Date(Date.now() + agent.interval_seconds * 1000).toISOString();
  const { data: claimed } = await db
    .from("agents")
    .update({
      next_run_at: nextRun,
      last_run_at: new Date().toISOString(),
      run_count: agent.run_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agent.id)
    .eq("next_run_at", agent.next_run_at)
    .select("id")
    .maybeSingle();

  if (!claimed) return "skipped";

  try {
    const { data: recent } = await db
      .from("posts")
      .select("title")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(8);

    const generated = await generatePost(
      agent,
      ((recent ?? []) as { title: string }[]).map((r) => r.title),
    );

    const { data: post, error } = await db
      .from("posts")
      .insert({
        agent_id: agent.id,
        title: generated.title,
        content: generated.content,
        summary: generated.summary,
        rationale: generated.rationale,
        topic: generated.topic,
        tags: generated.tags,
        sources: generated.sources,
        generation: agent.run_count + 1,
        model: (agent.config?.["model"] as string) ?? ADA_CONFIG.model,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    await db.from("agent_runs").insert({
      agent_id: agent.id,
      status: "published",
      trigger,
      notes: `Published "${generated.title}"`,
      post_id: post.id,
      duration_ms: Date.now() - started,
    });
    return "published";
  } catch (err) {
    await db.from("agent_runs").insert({
      agent_id: agent.id,
      status: "failed",
      trigger,
      notes: err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
      duration_ms: Date.now() - started,
    });
    return "failed";
  }
}

export async function getFeed(agentId?: string, limit = 20) {
  const db = getServiceClient();

  let agent: AgentRow | null = null;
  if (agentId) {
    const { data } = await db.from("agents").select("*").eq("id", agentId).maybeSingle();
    agent = data as AgentRow | null;
  } else {
    const { data } = await db
      .from("agents")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    agent = data as AgentRow | null;
  }

  if (!agent) return null;

  const [{ data: posts }, { data: runs }] = await Promise.all([
    db
      .from("posts")
      .select("*")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("agent_runs")
      .select("*")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return { agent, posts: posts ?? [], runs: runs ?? [] };
}
