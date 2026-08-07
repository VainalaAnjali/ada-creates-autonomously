const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

export async function handleAgentInit(request: Request): Promise<Response> {
  try {
    const engine = await import("./agent-engine.server");
    let overrides: Record<string, unknown> = {};
    try {
      const body = await request.json();
      if (body && typeof body === "object") overrides = body as Record<string, unknown>;
    } catch {
      /* empty body is fine */
    }

    const { agent, created } = await engine.initAgent({
      ...(typeof overrides["name"] === "string" ? { name: overrides["name"] } : {}),
      ...(typeof overrides["domain"] === "string" ? { domain: overrides["domain"] } : {}),
      ...(typeof overrides["intervalSeconds"] === "number"
        ? { interval_seconds: Math.max(30, overrides["intervalSeconds"] as number) }
        : {}),
    });

    // Publish the first post immediately so the agent is live right after init.
    if (created) await engine.runAgentOnce(agent, "init");

    return json({
      success: true,
      created,
      agentId: agent.id,
      agent: {
        id: agent.id,
        name: agent.name,
        domain: agent.domain,
        status: agent.status,
        autonomous: agent.autonomous,
        intervalSeconds: agent.interval_seconds,
        createdAt: agent.created_at,
      },
    });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : "init failed" }, 500);
  }
}

export async function handleAgentFeed(request: Request): Promise<Response> {
  try {
    const engine = await import("./agent-engine.server");
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId") ?? undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);

    // Autonomous catch-up: publish anything the schedule says is due.
    await engine.runDueAgents("feed");

    const feed = await engine.getFeed(agentId, limit);
    if (!feed) return json({ success: false, error: "Agent not found. Call /api/agent/init first." }, 404);

    const { agent, posts, runs } = feed;
    return json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        domain: agent.domain,
        status: agent.status,
        autonomous: agent.autonomous,
        intervalSeconds: agent.interval_seconds,
        lastRunAt: agent.last_run_at,
        nextRunAt: agent.next_run_at,
        runCount: agent.run_count,
        createdAt: agent.created_at,
      },
      count: posts.length,
      posts: posts.map((p: Record<string, unknown>) => ({
        id: p["id"],
        title: p["title"],
        content: p["content"],
        summary: p["summary"],
        rationale: p["rationale"],
        sources: p["sources"],
        tags: p["tags"],
        topic: p["topic"],
        generation: p["generation"],
        model: p["model"],
        createdAt: p["created_at"],
      })),
      history: runs.map((r: Record<string, unknown>) => ({
        id: r["id"],
        status: r["status"],
        trigger: r["trigger"],
        notes: r["notes"],
        durationMs: r["duration_ms"],
        createdAt: r["created_at"],
      })),
    });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : "feed failed" }, 500);
  }
}

export async function handleAgentTick(): Promise<Response> {
  try {
    const engine = await import("./agent-engine.server");
    const results = await engine.runDueAgents("cron");
    return json({ success: true, results });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : "tick failed" }, 500);
  }
}

export const corsPreflight = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type,apikey,authorization",
    },
  });
