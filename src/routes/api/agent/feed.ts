import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/agent/feed")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/agent-http.server")).corsPreflight(),
      GET: async ({ request }) =>
        (await import("@/lib/agent-http.server")).handleAgentFeed(request),
    },
  },
});
