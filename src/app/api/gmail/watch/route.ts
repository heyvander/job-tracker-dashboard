import { authOptions } from "@/lib/auth";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const accessToken = (token?.accessToken as string | undefined) ?? session?.accessToken;
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 });
  }
  if (!topicName) {
    return NextResponse.json(
      { error: "Missing GMAIL_PUBSUB_TOPIC env (format: projects/<id>/topics/<name>)" },
      { status: 500 },
    );
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const result = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: ["INBOX"],
      labelFilterAction: "include",
    },
  });

  return NextResponse.json({
    ok: true,
    historyId: result.data.historyId,
    expiration: result.data.expiration,
  });
}
