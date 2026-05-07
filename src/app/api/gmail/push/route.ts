import { NextRequest, NextResponse } from "next/server";
import {
  getIntegrationByEmail,
  integrationPersistenceEnabled,
  updateHistoryFromPush,
} from "@/lib/userIntegrationStore";

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
  const emailAddress = payload.emailAddress?.trim().toLowerCase() ?? "";
  const persistenceEnabled = integrationPersistenceEnabled();

  // In multi-user mode, only sync known users.
  if (persistenceEnabled && emailAddress) {
    const existing = await getIntegrationByEmail(emailAddress);
    if (!existing) {
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason: "No user integration found for push email",
          payload,
        },
        { status: 202 },
      );
    }
    await updateHistoryFromPush({
      email: emailAddress,
      gmailHistoryId: payload.historyId,
    });
  }

  const baseUrl =
    process.env.APP_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;

  const syncResponse = await fetch(`${baseUrl}/api/sync`, {
    method: "POST",
    headers: {
      "x-sync-webhook-secret": expectedSecret,
      ...(emailAddress ? { "x-sync-user-email": emailAddress } : {}),
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
    persistenceEnabled,
    payload,
    sync: syncResult,
  });
}
