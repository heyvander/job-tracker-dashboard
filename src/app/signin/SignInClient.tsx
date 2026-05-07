"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "Access was denied. Please try a different Google account.",
  Configuration: "Authentication is not configured correctly on the server.",
  OAuthAccountNotLinked: "This email is linked to a different sign-in provider.",
  OAuthCallback: "Google sign-in callback failed. Please try again.",
  OAuthCreateAccount: "Could not create your account from Google login.",
  OAuthSignin: "Could not start Google sign-in. Please try again.",
  SessionRequired: "Please sign in to continue.",
  default: "Sign in failed. Please try again.",
};

export default function SignInClient() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? "";
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.default) : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-black">
      <main className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Welcome back</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with Google to sync Gmail updates and manage your job pipeline.
        </p>

        {errorMessage ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="mt-6 w-full rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue with Google
        </button>

        <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          By continuing, you agree to use Google OAuth scopes for Gmail and Sheets access.
        </p>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
