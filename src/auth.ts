import NextAuth from "next-auth";
import { connection } from "next/server";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

// Database sessions: the session cookie is an opaque token, and the user row
// (including favoriteMovie) is the single source of truth on every request.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [Google],
  // Auth errors (e.g. cancelled consent) land on "/?error=..." instead of Auth.js's default page.
  pages: { signIn: "/", error: "/" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

/** Returns the signed-in user's id, or null. Never trust a client-supplied id. */
export async function getSessionUserId(): Promise<string | null> {
  // Auth.js uses crypto randomness internally; mark this as request-time so it's never prerendered.
  await connection();
  const session = await auth();
  return session?.user?.id ?? null;
}
