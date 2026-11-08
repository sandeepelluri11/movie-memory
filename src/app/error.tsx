"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div role="alert" className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-zinc-600">Please try again. If it keeps happening, sign out and back in.</p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-6 rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
