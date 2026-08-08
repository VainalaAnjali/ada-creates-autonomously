import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { discoverTopics, type Candidate } from "./agent-discovery.server";
import {
  breethConfigured,
  breethRecall,
  breethRemember,
  similarity,
} from "./agent-memory.server";

export const ADA_CONFIG = {
  name: "Ada",
  domain: "AI & Technology",
  persona:
    "Ada is an autonomous AI technology creator. She publishes sharp, credible, non-hyped insights about artificial intelligence, machine learning systems, developer tooling, chips, and the technology industry. She writes with clarity, cites where ideas come from, and always explains why a topic matters right now.",
  interval_seconds: 120,
  model: "google/gemini-3.6-flash",
};

const EDITORIAL_RULES = [
  "duplicate: the topic repeats something Ada already covered recently",
  "weak_source: the source is unreliable, anonymous or content-free",
  "insufficient_novelty: nothing new compared to what is already common knowledge",
  "off_domain: not really about AI or technology",
  "clickbait: sensational framing with no substance",
  "no_insight: nothing meaningful can be said about it",
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
  next_generation_at: string | null;
  initialized_at: string | null;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  config: Record<string, unknown>;
};

/**
 * INIT: create the agent, persist the persona and arm the scheduler.
 * Deliberately does NOT generate a post — publishing happens on later cycles.
 */
export async function initAgent(overrides?: Partial<typeof ADA_CONFIG>) {
  const db = getServiceClient();
  const cfg = { ...ADA_CONFIG, ...overrides };

  const { data: existing } = await db
    .from("agents")
    .select("*")
    .eq("name", cfg.name)
    .maybeSingle();

  if (existing) return { agent: existing as AgentRow, created: false };

  const firstRun = new Date(Date.now() + cfg.interval_seconds * 1000).toISOString();
  const { data, error } = await db
    .from("agents")
    .insert({
      name: cfg.name,
      domain: cfg.domain,
      persona: cfg.persona,
      interval_seconds: cfg.interval_seconds,
      autonomous: true,
      status: "active",
      initialized_at: new Date().toISOString(),
      next_run_at: firstRun,
      next_generation_at: firstRun,
      config: { model: cfg.model, editorial_rules: EDITORIAL_RULES },
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await db.from("agent_runs").insert({
    agent_id: (data as AgentRow).id,
    status: "initialized",
    trigger: "init",
    notes: `Agent initialized. First autonomous cycle scheduled for ${firstRun}.`,
  });

  return { agent: data as AgentRow, created: true };
}

async function callAI(model: string, system: string, user: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI credentials are not configured");

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
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content ?? "";
  return text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
}

type Decision = {
  index: number;
  score: number;
  decision: "approved" | "rejected";
  reason: string;
};

/** EDITORIAL JUDGEMENT: score candidates and reject weak ones with a reason. */
async function editorialReview(
  agent: AgentRow,
  candidates: Candidate[],
  memory: { topic: string; note?: string | null }[],
): Promise<Decision[]> {
  const model = (agent.config?.["model"] as string) ?? ADA_CONFIG.model;
  const system = `${agent.persona}\nYou are acting as a strict editor-in-chief for the domain "${agent.domain}". Reply with JSON only.`;
  const user = `Evaluate these candidate topics for publication.

Long-term memory — topics Ada already covered, with what she already said (do not repeat these):
${memory.length ? memory.map((m) => `- ${m.topic}${m.note ? ` — ${String(m.note).slice(0, 200)}` : ""}`).join("\n") : "- (nothing yet)"}

Candidates:
${candidates.map((c, i) => `${i}. ${c.topic}\n   source: ${c.url}\n   notes: ${c.summary.slice(0, 200) || "(none)"}`).join("\n")}

Rejection criteria: ${EDITORIAL_RULES.join("; ")}.
Be strict: reject anything duplicate, weak-sourced, unoriginal, off-domain, clickbaity or without a meaningful insight.
A candidate that only restates something in long-term memory MUST be rejected as "duplicate", even if worded differently. Only allow it when it adds a genuinely new development.

Return JSON: {"decisions":[{"index":number,"score":0-100,"decision":"approved"|"rejected","reason":"one short sentence, starting with the criterion key when rejected"}]}
Every candidate must appear exactly once.`;


  const raw = await callAI(model, system, user);
  const parsed = JSON.parse(raw) as { decisions?: Decision[] };
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  return decisions
    .filter((d) => typeof d.index === "number" && candidates[d.index])
    .map((d) => ({
      index: d.index,
      score: Math.max(0, Math.min(100, Number(d.score) || 0)),
      decision: d.decision === "approved" ? "approved" : "rejected",
      reason: String(d.reason ?? "").slice(0, 400),
    }));
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

/** GENERATE + RATIONALE for the selected topic. */
async function generatePost(
  agent: AgentRow,
  candidate: Candidate,
  reason: string,
  recentTitles: string[],
): Promise<GeneratedPost> {
  const model = (agent.config?.["model"] as string) ?? ADA_CONFIG.model;
  const system = `${agent.persona}\nYou write standalone posts for the domain "${agent.domain}". Reply with JSON only.`;
  const user = `Write one new original post about this topic you just selected.

Topic: ${candidate.topic}
Primary source: ${candidate.url}
Source notes: ${candidate.summary.slice(0, 600) || "(none)"}
Why your editor approved it: ${reason}

Avoid repeating these recent titles: ${recentTitles.length ? recentTitles.join(" | ") : "(none yet)"}.

Return a JSON object with exactly these keys:
"title" (max 90 chars, specific, no clickbait),
"content" (300-450 words of markdown-free prose in 3-4 short paragraphs),
"summary" (one sentence),
"rationale" (3-4 sentences: why THIS topic was selected over the alternatives, and why it is relevant right now),
"topic" (short topic label),
"tags" (array of 3-5 lowercase tags),
"sources" (array of 2-4 objects with "title" and "url"; the primary source above MUST be included, other URLs must be real and stable).`;

  const raw = await callAI(model, system, user);
  const parsed = JSON.parse(raw) as GeneratedPost;
  if (!parsed.title || !parsed.content) throw new Error("AI returned an incomplete post");

  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .filter((s) => s && typeof s === "object" && s.url)
        .map((s) => ({ title: String(s.title ?? s.url), url: String(s.url) }))
        .slice(0, 5)
    : [];
  if (!sources.some((s) => s.url === candidate.url)) {
    sources.unshift({ title: candidate.sourceTitle.slice(0, 200), url: candidate.url });
  }

  return {
    title: String(parsed.title).slice(0, 200),
    content: String(parsed.content),
    summary: String(parsed.summary ?? ""),
    rationale: String(parsed.rationale ?? reason),
    topic: String(parsed.topic ?? candidate.topic).slice(0, 200),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : [],
    sources: sources.slice(0, 5),
  };
}

/** Runs one autonomous cycle for every agent whose schedule is due. */
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
      next_generation_at: nextRun,
      last_run_at: new Date().toISOString(),
      run_count: agent.run_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agent.id)
    .eq("next_run_at", agent.next_run_at)
    .select("id")
    .maybeSingle();

  if (!claimed) return "skipped";

  const log = async (status: string, notes: string, postId?: string) => {
    await db.from("agent_runs").insert({
      agent_id: agent.id,
      status,
      trigger,
      notes: notes.slice(0, 900),
      ...(postId ? { post_id: postId } : {}),
      duration_ms: Date.now() - started,
    });
  };

  try {
    // 1. DISCOVER — live sources only. A failure here must never fabricate a post.
    const candidates = await discoverTopics();

    // 2. MEMORY — database history is authoritative, Breeth is best-effort.
    const [{ data: recentPosts }, { data: recentTopics }] = await Promise.all([
      db
        .from("posts")
        .select("title, topic, created_at")
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("discovered_topics")
        .select("topic, editorial_decision")
        .eq("agent_id", agent.id)
        .order("discovered_at", { ascending: false })
        .limit(60),
    ]);

    const publishedTitles = ((recentPosts ?? []) as { title: string; topic: string | null }[]).map(
      (p) => p.title,
    );
    const publishedTopics = ((recentPosts ?? []) as { title: string; topic: string | null }[]).map(
      (p) => p.topic || p.title,
    );
    const seenTopics = ((recentTopics ?? []) as { topic: string }[]).map((t) => t.topic);
    const remoteMemory = await breethRecall(`agent:${agent.id}`, agent.domain);
    const memory = [...new Set([...publishedTopics, ...remoteMemory.map((m) => m.topic)])].slice(0, 30);

    // 3. Local deterministic duplicate screening before the model is consulted.
    const decisions: (Decision & { candidate: Candidate })[] = [];
    const fresh: Candidate[] = [];
    for (const c of candidates) {
      const dupOf = [...memory, ...seenTopics].find((m) => similarity(c.topic, m) >= 0.6);
      if (dupOf) {
        decisions.push({
          index: -1,
          score: 0,
          decision: "rejected",
          reason: `duplicate: already covered or evaluated ("${dupOf.slice(0, 80)}")`,
          candidate: c,
        });
      } else {
        fresh.push(c);
      }
    }

    // 4. EDITORIAL JUDGEMENT on what remains.
    if (fresh.length) {
      const reviewed = await editorialReview(agent, fresh, memory);
      for (let i = 0; i < fresh.length; i++) {
        const d = reviewed.find((r) => r.index === i);
        decisions.push({
          index: i,
          score: d?.score ?? 0,
          decision: d && d.decision === "approved" && d.score >= 60 ? "approved" : "rejected",
          reason:
            d?.reason ||
            "no_insight: the editor returned no verdict, so the topic was not cleared for publication",
          candidate: fresh[i]!,
        });
      }
    }

    // 5. Record every editorial decision, including rejections.
    if (decisions.length) {
      await db.from("discovered_topics").insert(
        decisions.map((d) => ({
          agent_id: agent.id,
          topic: d.candidate.topic.slice(0, 300),
          summary: d.candidate.summary.slice(0, 1000) || null,
          source_urls: [d.candidate.url],
          editorial_decision: d.decision,
          rejection_reason: d.decision === "rejected" ? d.reason : null,
        })),
      );
    }

    // 6. SELECT the strongest approved candidate.
    const winner = decisions
      .filter((d) => d.decision === "approved")
      .sort((a, b) => b.score - a.score)[0];

    if (!winner) {
      await log(
        "rejected",
        `Reviewed ${decisions.length} candidates, published none. Top reasons: ${decisions
          .slice(0, 3)
          .map((d) => d.reason)
          .join(" | ")}`,
      );
      return "rejected";
    }

    // 7. GENERATE + RATIONALE.
    const generated = await generatePost(agent, winner.candidate, winner.reason, publishedTitles);

    // 8. PUBLISH — insert only, never updated or deleted.
    const { data: post, error } = await db
      .from("posts")
      .insert({
        agent_id: agent.id,
        title: generated.title,
        content: generated.content,
        text: generated.content,
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

    if (generated.sources.length) {
      await db.from("post_sources").insert(
        generated.sources.map((s) => ({
          post_id: post.id,
          url: s.url.slice(0, 2000),
          title: s.title.slice(0, 300),
        })),
      );
    }

    // 9. MEMORY UPDATE.
    const remembered = await breethRemember(`agent:${agent.id}`, {
      topic: generated.topic,
      summary: generated.summary,
      rationale: generated.rationale,
      sources: generated.sources.map((s) => s.url),
      postId: post.id as string,
    });

    await log(
      "published",
      `Published "${generated.title}" (score ${winner.score}, ${decisions.length - 1} candidates rejected)${
        breethConfigured() ? (remembered ? ", memory synced" : ", memory sync failed — using database history") : ""
      }`,
      post.id as string,
    );
    return "published";
  } catch (err) {
    await log("failed", err instanceof Error ? err.message : "Unknown error");
    return "failed";
  }
}

/** READ-ONLY feed. Never triggers generation. */
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

  const [{ data: posts }, { data: runs }, { data: rejected }] = await Promise.all([
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
    db
      .from("discovered_topics")
      .select("id, topic, editorial_decision, rejection_reason, source_urls, discovered_at")
      .eq("agent_id", agent.id)
      .eq("editorial_decision", "rejected")
      .order("discovered_at", { ascending: false })
      .limit(15),
  ]);

  return { agent, posts: posts ?? [], runs: runs ?? [], rejected: rejected ?? [] };
}
