
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS initialized_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS next_generation_at timestamptz;

UPDATE public.agents SET next_generation_at = next_run_at WHERE next_generation_at IS NULL;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS text text;

UPDATE public.posts SET text = content WHERE text IS NULL;

CREATE OR REPLACE FUNCTION public.sync_post_text()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.text IS NULL OR NEW.text = '' THEN
    NEW.text := NEW.content;
  ELSIF NEW.content IS NULL OR NEW.content = '' THEN
    NEW.content := NEW.text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_sync_text ON public.posts;
CREATE TRIGGER posts_sync_text
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.sync_post_text();

CREATE TABLE IF NOT EXISTS public.post_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.post_sources TO anon, authenticated;
GRANT ALL ON public.post_sources TO service_role;
ALTER TABLE public.post_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read post sources" ON public.post_sources FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.discovered_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  topic text NOT NULL,
  summary text,
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  editorial_decision text NOT NULL DEFAULT 'pending',
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.discovered_topics TO anon, authenticated;
GRANT ALL ON public.discovered_topics TO service_role;
ALTER TABLE public.discovered_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read discovered topics" ON public.discovered_topics FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_discovered_topics_updated_at ON public.discovered_topics;
CREATE TRIGGER update_discovered_topics_updated_at
BEFORE UPDATE ON public.discovered_topics
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_posts_agent_id ON public.posts(agent_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_agent_created ON public.posts(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_sources_post_id ON public.post_sources(post_id);
CREATE INDEX IF NOT EXISTS idx_discovered_topics_agent_id ON public.discovered_topics(agent_id);
CREATE INDEX IF NOT EXISTS idx_discovered_topics_discovered_at ON public.discovered_topics(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON public.agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON public.agent_runs(created_at DESC);
