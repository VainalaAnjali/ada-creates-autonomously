import { createFileRoute } from "@tanstack/react-router";

// Diagnostics: verifies Breeth read/write connectivity and the memory -> editorial loop.
// Never generates posts and never touches the autonomous schedule. No secrets returned.
export const Route = createFileRoute("/api/public/hooks/breeth-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const body: Record<string, unknown> = { success: true };

        if (url.searchParams.get("dryRun") === "1") {
          const { memoryDryRun } = await import("@/lib/agent-engine.server");
          body["dryRun"] = await memoryDryRun(url.searchParams.get("seed") ?? undefined);
        } else {
          const { breethHealth } = await import("@/lib/agent-memory.server");
          body["breeth"] = await breethHealth();
        }

        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
