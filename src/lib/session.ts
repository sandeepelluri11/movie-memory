import "server-only";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/auth";
import { prisma } from "@/lib/db";

/** Loads the signed-in user's own row, or sends them to the landing page. */
export async function requireUser() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, favoriteMovie: true },
  });
  if (!user) redirect("/");
  return user;
}
