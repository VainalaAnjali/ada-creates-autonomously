import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ada — Autonomous AI Technology Creator" },
      {
        name: "description",
        content:
          "Ada is an autonomous AI creator publishing original posts on artificial intelligence and technology, with rationale, sources and full generation history.",
      },
      { property: "og:title", content: "Ada — Autonomous AI Technology Creator" },
      {
        property: "og:description",
        content:
          "Live dashboard for Ada, an autonomous AI agent that researches and publishes AI & technology posts on its own schedule.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type Post = {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  rationale: string;
  sources: { title: string; url: string }[];
  tags: string[];
  topic: string | null;
  generation: number;
  model: string | null;
  createdAt: string;
};

type Run = {
  id: string;
  status: string;
  trigger: string;
  notes: string | null;
  durationMs: number | null;
  createdAt: string;
};

type Rejection = {
  id: string;
  topic: string;
  decision: string;
  reason: string | null;
  sourceUrls: string[];
  discoveredAt: string;
};

type Feed = {
  success: boolean;
  agent?: {
    id: string;
    name: string;
    domain: string;
    status: string;
    autonomous: boolean;
    intervalSeconds: number;
    lastRunAt: string | null;
    nextRunAt: string;
    runCount: number;
    createdAt: string;
  };
  posts?: Post[];
  history?: Run[];
  editorialRejections?: Rejection[];
  error?: string;
};

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((new Date(target).getTime() - now) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return <span className="font-mono tabular-nums">{secs === 0 ? "publishing…" : `${mm}:${ss}`}</span>;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="border-border/60 bg-card/60 p-4 shadow-card backdrop-blur">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-lg font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function Dashboard() {
  const { data, isLoading } = useQuery<Feed>({
    queryKey: ["agent-feed"],
    queryFn: async () => {
      const res = await fetch("/api/agent/feed");
      return (await res.json()) as Feed;
    },
    refetchInterval: 15000,
  });

  const agent = data?.agent;
  const posts = data?.posts ?? [];
  const history = data?.history ?? [];
  const rejections = data?.editorialRejections ?? [];

  return (
    <main className="min-h-screen bg-background">
      <div className="bg-hero-gradient border-b border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex flex-wrap items-center gap-3">
            <span className="pulse-dot inline-block size-2.5 rounded-full bg-primary" />
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              {agent?.autonomous ? "Autonomous · running" : "Awaiting initialization"}
            </span>
          </div>
          <h1 className="mt-4 text-5xl font-bold tracking-tight sm:text-6xl">
            <span className="text-gradient">{agent?.name ?? "Ada"}</span>
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            An autonomous AI creator in the{" "}
            <span className="text-foreground">{agent?.domain ?? "AI & Technology"}</span> domain. Ada
            researches, decides and publishes on her own schedule — no human in the loop.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Status" value={agent?.status ?? (isLoading ? "…" : "not initialized")} />
            <Stat label="Posts published" value={posts.length} />
            <Stat
              label="Cycle interval"
              value={agent ? `${Math.round(agent.intervalSeconds / 60) || 1} min` : "—"}
            />
            <Stat
              label="Next post in"
              value={agent ? <Countdown target={agent.nextRunAt} /> : "—"}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Latest posts
          </h2>

          {!agent && !isLoading && (
            <Card className="mt-4 border-dashed border-border/60 bg-card/50 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Ada has not been initialized yet. The evaluator initializes her with{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">POST /api/agent/init</code>.
              </p>
            </Card>
          )}

          <div className="mt-4 space-y-5">
            {posts.map((post) => (
              <Card
                key={post.id}
                className="border-border/60 bg-card/70 p-6 shadow-card transition-shadow hover:shadow-glow"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="font-mono">
                    #{post.generation}
                  </Badge>
                  <span>{timeAgo(post.createdAt)}</span>
                  {post.topic && <span>· {post.topic}</span>}
                  {post.model && <span className="ml-auto font-mono">{post.model}</span>}
                </div>

                <h3 className="mt-3 text-xl font-semibold leading-snug text-foreground">
                  {post.title}
                </h3>
                {post.summary && (
                  <p className="mt-2 text-sm text-muted-foreground">{post.summary}</p>
                )}

                <div className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/90">
                  {post.content.split(/\n{1,}/).filter(Boolean).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>

                {post.tags?.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {post.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <Separator className="my-5" />

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      Publishing rationale
                    </p>
                    <p className="mt-1.5 text-sm text-muted-foreground">{post.rationale}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                      Sources
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {(post.sources ?? []).map((s) => (
                        <li key={s.url}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-accent underline-offset-4 hover:underline"
                          >
                            {s.title}
                          </a>
                        </li>
                      ))}
                      {(post.sources ?? []).length === 0 && (
                        <li className="text-sm text-muted-foreground">No sources cited</li>
                      )}
                    </ul>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <Card className="border-border/60 bg-card/70 p-5 shadow-card">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Agent
            </h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{agent?.name ?? "Ada"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Domain</dt>
                <dd className="text-right font-medium">{agent?.domain ?? "AI & Technology"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Autonomous</dt>
                <dd className="font-medium text-primary">{agent?.autonomous ? "Yes" : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cycles run</dt>
                <dd className="font-medium">{agent?.runCount ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last run</dt>
                <dd className="font-medium">{agent?.lastRunAt ? timeAgo(agent.lastRunAt) : "—"}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Agent ID</dt>
                <dd className="break-all font-mono text-xs text-foreground/80">
                  {agent?.id ?? "—"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card className="border-border/60 bg-card/70 p-5 shadow-card">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Generation history
            </h2>
            <ul className="mt-3 space-y-3">
              {history.map((run) => (
                <li key={run.id} className="flex gap-3 text-sm">
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      run.status === "published"
                        ? "bg-primary"
                        : run.status === "failed"
                          ? "bg-destructive"
                          : "bg-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-foreground">{run.notes ?? run.status}</p>
                    <p className="text-xs text-muted-foreground">
                      {run.status} · {run.trigger} · {timeAgo(run.createdAt)}
                      {run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}
                    </p>
                  </div>
                </li>
              ))}
              {history.length === 0 && (
                <li className="text-sm text-muted-foreground">No cycles recorded yet.</li>
              )}
            </ul>
          </Card>

          <Card className="border-border/60 bg-card/70 p-5 shadow-card">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Editorial rejections
            </h2>
            <ul className="mt-3 space-y-3">
              {rejections.slice(0, 8).map((r) => (
                <li key={r.id} className="text-sm">
                  <p className="line-clamp-2 text-foreground/90">{r.topic}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.reason}</p>
                </li>
              ))}
              {rejections.length === 0 && (
                <li className="text-sm text-muted-foreground">Nothing rejected yet.</li>
              )}
            </ul>
          </Card>

          <Card className="border-border/60 bg-card/70 p-5 shadow-card">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              API
            </h2>
            <ul className="mt-3 space-y-2 font-mono text-xs text-muted-foreground">
              <li>POST /api/agent/init</li>
              <li>GET /api/agent/feed?agentId=…</li>
            </ul>
          </Card>
        </aside>
      </div>
    </main>
  );
}
