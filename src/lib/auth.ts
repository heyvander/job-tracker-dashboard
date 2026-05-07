import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import { upsertOAuthTokens } from "@/lib/userIntegrationStore";

type TokenWithOAuth = JWT & {
  accessToken?: string;
  accessTokenExpires?: number;
  refreshToken?: string;
  error?: "RefreshAccessTokenError";
};

async function refreshAccessToken(token: TokenWithOAuth): Promise<TokenWithOAuth> {
  try {
    if (!token.refreshToken) {
      return { ...token, error: "RefreshAccessTokenError" };
    }

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const refreshed = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
    };

    if (!response.ok || !refreshed.access_token || !refreshed.expires_in) {
      return { ...token, error: "RefreshAccessTokenError" };
    }

    return {
      ...token,
      accessToken: refreshed.access_token,
      accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

async function persistTokens(token: TokenWithOAuth): Promise<void> {
  try {
    const email = typeof token.email === "string" ? token.email.trim().toLowerCase() : "";
    if (!email) return;
    await upsertOAuthTokens({
      email,
      accessToken: token.accessToken ?? null,
      refreshToken: token.refreshToken ?? null,
      accessTokenExpiresAt: token.accessTokenExpires ?? null,
    });
  } catch {
    // Keep auth flow resilient even if persistence is unavailable.
  }
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/signin",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/spreadsheets",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      const nextToken = token as TokenWithOAuth;

      if (account) {
        nextToken.accessToken = account.access_token;
        nextToken.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : undefined;
        nextToken.refreshToken = account.refresh_token ?? nextToken.refreshToken;
        await persistTokens(nextToken);
        return nextToken;
      }

      if (
        nextToken.accessToken &&
        nextToken.accessTokenExpires &&
        Date.now() < nextToken.accessTokenExpires
      ) {
        return nextToken;
      }

      if (nextToken.refreshToken) {
        const refreshedToken = await refreshAccessToken(nextToken);
        await persistTokens(refreshedToken);
        return refreshedToken;
      }

      await persistTokens(nextToken);
      return nextToken;
    },
    async session({ session, token }) {
      const typedToken = token as TokenWithOAuth;
      session.accessToken = typedToken.accessToken;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
