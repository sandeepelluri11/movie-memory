"use client";

import { useActionState } from "react";
import { saveFavoriteMovie, type OnboardingState } from "../actions";
import { MOVIE_MAX_LENGTH } from "@/lib/movie";

const initialState: OnboardingState = { error: null, value: "" };

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-3">
      <label htmlFor="movie" className="sr-only">
        Favorite movie
      </label>
      {/* Client-side attributes are UX only; the server action re-validates. */}
      <input
        id="movie"
        name="movie"
        required
        maxLength={MOVIE_MAX_LENGTH}
        defaultValue={state.value}
        placeholder="e.g. Spirited Away"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "movie-error" : undefined}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 outline-none focus:border-zinc-900"
      />
      {state.error && (
        <p id="movie-error" role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
