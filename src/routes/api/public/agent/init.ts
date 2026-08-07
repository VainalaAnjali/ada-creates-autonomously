import { createFileRoute } from "@tanstack/react-router";

// Mirror of /api/agent/init that bypasses published-site auth for external evaluators.
export const Route = createFileRoute("/api/public/agent/init")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/agent-http.server")).corsPreflight(),
      POST: async ({ request }) =>
        (await import("@/lib/agent-http.server")).handleAgentInit(request),
    },
  },
});
