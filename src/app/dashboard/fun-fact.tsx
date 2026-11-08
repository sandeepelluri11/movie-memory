"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ErrorResponse, FactResponse } from "@/lib/facts/api-types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: FactResponse };

// Fetched client-side so a slow OpenAI call never blocks the dashboard render.
export function FunFact() {
  const [state, setState] = useState<State>({ status: "loading" });
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });

    try {
      const res = await fetch("/api/fact", { cache: "no-store", signal: controller.signal });
      if (res.status === 401) {
        router.replace("/");
        return;
      }
      const body = (await res.json()) as FactResponse | ErrorResponse;
      if (!res.ok || "error" in body) {
        setState({ status: "error", message: "error" in body ? body.error : "Something went wrong." });
        return;
      }
      setState({ status: "ready", data: body });
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error(err);
      setState({ status: "error", message: "Couldn't reach the server. Please try again." });
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount is the intent here
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return (
    <section className="mt-8 rounded-xl bg-zinc-50 p-5 ring-1 ring-zinc-200" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Fun fact</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.status === "loading"}
          className="rounded-lg px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {state.status === "loading" && <p className="mt-3 animate-pulse text-zinc-500">Finding a fun fact…</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-3 text-red-600">
          {state.message}
        </p>
      )}
      {state.status === "ready" && (
        <>
          <p className="mt-3 leading-relaxed">{state.data.fact.content}</p>
          <p className="mt-3 text-xs text-zinc-500">
            {state.data.source === "stale-fallback"
              ? "Couldn't get a new fact right now, so here's a recent one."
              : "New facts are generated at most once a minute."}
          </p>
        </>
      )}
    </section>
  );
}
