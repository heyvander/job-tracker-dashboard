import { NextRequest, NextResponse } from "next/server";

type PubSubEnvelope = {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
};

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.SYNC_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PubSubEnvelope;
  const payloadRaw = body.message?.data
    ? Buffer.from(body.message.data, "base64").toString("utf8")
    : "{}";
  const payload = JSON.parse(payloadRaw) as { emailAddress?: string; historyId?: string };

  const baseUrl =
    process.env.APP_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;

  const syncResponse = await fetch(`${baseUrl}/api/sync`, {
    method: "POST",
    headers: {
      "x-sync-webhook-secret": expectedSecret,
    },
  });

  if (!syncResponse.ok) {
    const details = await syncResponse.text();
    return NextResponse.json(
      { error: "Sync failed", details, payload },
      { status: 500 },
    );
  }

  const syncResult = await syncResponse.json();
  return NextResponse.json({
    ok: true,
    payload,
    sync: syncResult,
  });
}
