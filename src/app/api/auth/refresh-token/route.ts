import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const explicitlyEnabled = process.env.ENABLE_DEV_TOKEN_EXPORT === "true";
  if (!isDev && !explicitlyEnabled) {
    return NextResponse.json(
      { error: "Disabled in production. Set ENABLE_DEV_TOKEN_EXPORT=true to allow temporarily." },
      { status: 403 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const refreshToken = token?.refreshToken as string | undefined;
  if (!refreshToken) {
    return NextResponse.json(
      {
        error:
          "No refresh token in session. Sign out and sign in again to trigger consent, then retry.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ refreshToken });
}
