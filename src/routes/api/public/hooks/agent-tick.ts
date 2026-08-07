import { createFileRoute } from "@tanstack/react-router";

// Scheduled autonomous tick, called by the database cron job every minute.
export const Route = createFileRoute("/api/public/hooks/agent-tick")({
  server: {
    handlers: {
      POST: async () => (await import("@/lib/agent-http.server")).handleAgentTick(),
      GET: async () => (await import("@/lib/agent-http.server")).handleAgentTick(),
    },
  },
});
