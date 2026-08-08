import { createFileRoute } from "@tanstack/react-router";

// Diagnostics: verifies Breeth read/write connectivity. Never returns secrets.
export const Route = createFileRoute("/api/public/hooks/breeth-check")({
  server: {
    handlers: {
      GET: async () => {
        const { breethHealth } = await import("@/lib/agent-memory.server");
        const result = await breethHealth();
        return new Response(JSON.stringify({ success: true, breeth: result }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
