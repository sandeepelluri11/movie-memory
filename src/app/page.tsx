import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/auth";
import { signInWithGoogle } from "./actions";

async function RedirectIfSignedIn() {
  if (await getSessionUserId()) redirect("/dashboard");
  return null;
}

export default function LandingPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200">
        <h1 className="text-3xl font-semibold tracking-tight">Movie Memory</h1>
        <p className="mt-3 text-zinc-600">Tell us your favorite movie and get a fun fact about it.</p>
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
