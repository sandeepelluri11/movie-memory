import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

async function Onboarding() {
  const user = await requireUser();
  if (user.favoriteMovie) redirect("/dashboard");

  const firstName = user.name?.trim().split(/\s+/)[0];
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome{firstName ? `, ${firstName}` : ""}!</h1>
      <p className="mt-2 text-zinc-600">What&apos;s your favorite movie?</p>
      <OnboardingForm />
    </>
  );
}

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
          <Onboarding />
        </Suspense>
      </div>
    </main>
  );
}
