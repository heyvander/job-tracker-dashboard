import { authOptions } from "@/lib/auth";
import { getIntegrationByEmail, integrationPersistenceEnabled } from "@/lib/userIntegrationStore";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const tokenEmail = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
  const resolvedEmail = sessionEmail || tokenEmail;
  const persistenceEnabled = integrationPersistenceEnabled();

  if (!resolvedEmail) {
    return NextResponse.json(
      { error: "Not authenticated", persistenceEnabled },
      { status: 401 },
    );
  }

  const integration = persistenceEnabled ? await getIntegrationByEmail(resolvedEmail) : null;

  return NextResponse.json({
    ok: true,
    email: resolvedEmail,
    persistenceEnabled,
    integrationExists: Boolean(integration),
    integration: integration
      ? {
          sheetId: integration.sheetId,
          sheetUrl: integration.sheetUrl,
          gmailHistoryId: integration.gmailHistoryId,
          gmailWatchExpiration: integration.gmailWatchExpiration,
          hasGoogleAccessToken: Boolean(integration.googleAccessToken),
          hasGoogleRefreshToken: Boolean(integration.googleRefreshToken),
          googleAccessTokenExpiresAt: integration.googleAccessTokenExpiresAt,
          lastSyncAt: integration.lastSyncAt,
          lastSyncStatus: integration.lastSyncStatus,
          lastSyncError: integration.lastSyncError,
          updatedAt: integration.updatedAt,
        }
      : null,
  });
}
