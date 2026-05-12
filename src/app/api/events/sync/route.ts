import { authOptions } from "@/lib/auth";
import { subscribeSyncComplete } from "@/lib/syncEvents";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const tokenEmail = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
  const resolvedEmail = sessionEmail || tokenEmail;

  if (!resolvedEmail) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  /** Client disconnect often calls `cancel()` without firing `request.signal.abort`. */
  const streamLifecycle: { cleanup: () => void } = {
    cleanup: () => {
      // Replaced immediately inside `start` before any await.
    },
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: () => void = () => {};

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        try {
          unsubscribe();
        } catch {
          // Ignore unsubscribe errors.
        }
        try {
          controller.close();
        } catch {
          // Ignore close errors.
        }
      };

      streamLifecycle.cleanup = cleanup;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };

      const send = (event: string, payload: unknown) => {
        if (closed) return;
        safeEnqueue(encoder.encode(`event: ${event}\n`));
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send("connected", { ok: true, at: new Date().toISOString() });

      unsubscribe = await subscribeSyncComplete((payload) => {
        if (payload.email !== resolvedEmail) return;
        send("sync-complete", payload);
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        safeEnqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 20000);

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      streamLifecycle.cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
