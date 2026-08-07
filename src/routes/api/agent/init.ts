import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/agent/init")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/agent-http.server")).corsPreflight(),
      POST: async ({ request }) =>
        (await import("@/lib/agent-http.server")).handleAgentInit(request),
    },
  },
});
