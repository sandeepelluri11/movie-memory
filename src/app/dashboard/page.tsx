import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { signOutAction } from "../actions";
import { FunFact } from "./fun-fact";

function Avatar({ image, label }: { image: string | null; label: string }) {
  if (image) {
    return <Image src={image} alt="" width={64} height={64} className="size-16 rounded-full" referrerPolicy="no-referrer" />;
  }
  return (
    <div aria-hidden className="flex size-16 items-center justify-center rounded-full bg-zinc-200 text-xl font-semibold text-zinc-600">
      {label.charAt(0).toUpperCase()}
    </div>
  );
}

async function Dashboard() {
  const user = await requireUser();
  if (!user.favoriteMovie) redirect("/onboarding");

  // Google may omit name or photo; fall back gracefully.
  const displayName = user.name?.trim() || user.email || "Movie fan";

  return (
    <>
      <header className="flex items-center gap-4">
        <Avatar image={user.image} label={displayName} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{displayName}</h1>
          {user.email && <p className="truncate text-sm text-zinc-600">{user.email}</p>}
        </div>
        <form action={signOutAction}>
          <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            Log out
          </button>
        </form>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Favorite movie</h2>
        <p className="mt-1 text-2xl font-semibold">{user.favoriteMovie}</p>
      </section>

      <FunFact />
    </>
  );
}

export default function DashboardPage() {
  return (
    <main className="flex flex-1 justify-center p-6 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
          <Dashboard />
        </Suspense>
      </div>
    </main>
  );
}
