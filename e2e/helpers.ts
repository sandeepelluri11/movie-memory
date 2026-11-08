import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { APP_PORT, STUB_PORT } from "./global-setup";

export const BASE = `http://localhost:${APP_PORT}`;
const STUB = `http://127.0.0.1:${STUB_PORT}`;

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

export const EMAIL_DOMAIN = "e2e.example.com";

/** Creates a user plus a real Auth.js database session, and returns a cookie header for it. */
export async function createSignedInUser(opts: { favoriteMovie?: string | null; name?: string | null; image?: string | null } = {}) {
  const id = `e2e-${crypto.randomUUID()}`;
  const email = `${id}@${EMAIL_DOMAIN}`;
  await prisma.user.create({
    data: { id, email, name: opts.name ?? null, image: opts.image ?? null, favoriteMovie: opts.favoriteMovie ?? null },
  });
  const sessionToken = `tok-${crypto.randomUUID()}`;
  await prisma.session.create({ data: { sessionToken, userId: id, expires: new Date(Date.now() + 86_400_000) } });
  return { id, email, sessionToken, cookie: `authjs.session-token=${sessionToken}` };
}

export async function cleanupUsers() {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
}

export function get(path: string, cookie?: string) {
  return fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}

export const stub = {
  async set(state: { mode?: "ok" | "fail"; delayMs?: number }) {
    await fetch(`${STUB}/__control`, { method: "POST", body: JSON.stringify(state) });
  },
  async calls(): Promise<number> {
    return (await (await fetch(`${STUB}/__state`)).json()).calls;
  },
};
