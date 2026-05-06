import http from "node:http";

const port = Number(process.env.PORT ?? "4000");
const syncUrl = process.env.APP_SYNC_URL ?? "http://web:3000/api/sync";
const syncWebhookSecret = process.env.SYNC_WEBHOOK_SECRET ?? "";

async function triggerSync() {
  if (!syncWebhookSecret) {
    return {
      ok: false,
      status: 500,
      payload: { error: "Missing SYNC_WEBHOOK_SECRET for worker." },
    };
  }

  try {
    const response = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "x-sync-webhook-secret": syncWebhookSecret,
      },
    });

    const data = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload: data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "Failed to call app sync endpoint.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/healthz" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "sync-worker" }));
    return;
  }

  if (request.url === "/trigger-sync" && request.method === "POST") {
    const result = await triggerSync();
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result.payload));
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, () => {
  console.log(`sync-worker listening on port ${port}`);
});
