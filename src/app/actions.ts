"use server";

import { redirect } from "next/navigation";
import { getSessionUserId, signIn, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { validateFavoriteMovie } from "@/lib/movie";

export async function signInWithGoogle() {
  // The dashboard decides between onboarding (no movie yet) and the dashboard itself.
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export type OnboardingState = { error: string | null; value: string };

export async function saveFavoriteMovie(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const raw = formData.get("movie");
  const result = validateFavoriteMovie(raw);
  if (!result.ok) return { error: result.error, value: typeof raw === "string" ? raw : "" };

  // Onboarding is first-time only: the `favoriteMovie: null` guard means this can never overwrite.
  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: { favoriteMovie: result.movie },
  });
  redirect("/dashboard");
}
