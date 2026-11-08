import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/auth";
import { signInWithGoogle } from "./actions";

async function RedirectIfSignedIn() {
  if (await getSessionUserId()) redirect("/dashboard");
  return null;
}

async function SignInError({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const { error } = await searchParams;
  if (!error) return null;
  const message =
    error === "AccessDenied" ? "Sign-in was cancelled or denied." : "We couldn't sign you in. Please try again.";
  return (
    <p role="alert" className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

export default function LandingPage({ searchParams }: PageProps<"/">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200">
        <h1 className="text-3xl font-semibold tracking-tight">Movie Memory</h1>
        <p className="mt-3 text-zinc-600">Tell us your favorite movie and get a fun fact about it.</p>
        <Suspense fallback={null}>
          <SignInError searchParams={searchParams} />
        </Suspense>
        <form action={signInWithGoogle} className="mt-8">
          <button
            type="submit"
            className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white transition hover:bg-zinc-700"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
