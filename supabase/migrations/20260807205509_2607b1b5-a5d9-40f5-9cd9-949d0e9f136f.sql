CREATE TABLE public.agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  autonomous BOOLEAN NOT NULL DEFAULT true,
  interval_seconds INTEGER NOT NULL DEFAULT 120,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  rationale TEXT NOT NULL DEFAULT '',
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  topic TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX posts_agent_created_idx ON public.posts(agent_id, created_at DESC);

CREATE TABLE public.agent_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  notes TEXT,
  post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_agent_created_idx ON public.agent_runs(agent_id, created_at DESC);

GRANT SELECT ON public.agents TO anon, authenticated;
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT SELECT ON public.agent_runs TO anon, authenticated;
GRANT ALL ON public.agents TO service_role;
GRANT ALL ON public.posts TO service_role;
GRANT ALL ON public.agent_runs TO service_role;

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read agents" ON public.agents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can read posts" ON public.posts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can read runs" ON public.agent_runs FOR SELECT TO anon, authenticated USING (true);