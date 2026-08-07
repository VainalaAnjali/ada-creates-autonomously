import { createFileRoute } from "@tanstack/react-router";

// Mirror of /api/agent/feed that bypasses published-site auth for external evaluators.
export const Route = createFileRoute("/api/public/agent/feed")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/agent-http.server")).corsPreflight(),
      GET: async ({ request }) =>
        (await import("@/lib/agent-http.server")).handleAgentFeed(request),
    },
  },
});
