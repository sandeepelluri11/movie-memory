import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BASE, cleanupUsers, createSignedInUser, get, prisma, stub } from "./helpers";

beforeAll(cleanupUsers);
afterAll(async () => {
  await cleanupUsers();
  await prisma.$disconnect();
});
beforeEach(() => stub.set({ mode: "ok", delayMs: 0 }));

const fact = async (cookie: string, query = "") => {
  const res = await get(`/api/fact${query}`, cookie);
  return { status: res.status, body: await res.json() };
};

describe("signed out", () => {
  it("shows the landing page with Google sign-in", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Sign in with Google");
  });

  it.each(["/dashboard", "/onboarding"])("redirects %s to the landing page", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!, BASE).href).toBe(`${BASE}/`);
  });

  it("rejects the fact API with 401", async () => {
    expect((await get("/api/fact")).status).toBe(401);
  });

  it("does not trust a forged session cookie", async () => {
    const cookie = "authjs.session-token=forged";
    expect(await (await get("/dashboard", cookie)).text()).not.toContain("Favorite movie");
    expect((await get("/api/fact", cookie)).status).toBe(401);
  });

  it("shows a friendly message after a failed Google sign-in", async () => {
    expect(await (await get("/?error=AccessDenied")).text()).toContain("Sign-in was cancelled or denied.");
  });

  it("sends security headers", async () => {
    const res = await get("/");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("first-time user", () => {
  it("is routed from the dashboard to onboarding, which shows the form", async () => {
    const { cookie } = await createSignedInUser();
    expect(await (await get("/dashboard", cookie)).text()).toContain("/onboarding");
    expect(await (await get("/onboarding", cookie)).text()).toContain("favorite movie");
  });

  it("gets 409 from the fact API until onboarding is done", async () => {
    const { cookie } = await createSignedInUser();
    expect((await fact(cookie)).status).toBe(409);
  });
});

describe("returning user dashboard", () => {
  it("shows name, email, movie and logout", async () => {
    const { cookie, email } = await createSignedInUser({ favoriteMovie: "Heat", name: "Alice Tester" });
    const html = await (await get("/dashboard", cookie)).text();
    expect(html).toContain("Alice Tester");
    expect(html).toContain(email);
    expect(html).toContain(">Heat<");
    expect(html).toContain("Log out");
  });

  it("handles a missing Google name and photo", async () => {
    const { cookie, email } = await createSignedInUser({ favoriteMovie: "Heat" });
    const html = await (await get("/dashboard", cookie)).text();
    expect(html).toMatch(new RegExp(`<h1[^>]*>${email}</h1>`));
    expect(html).toMatch(/aria-hidden="true"[^>]*>E<\/div>/);
  });

  it("sends a user who already onboarded away from onboarding", async () => {
    const { cookie } = await createSignedInUser({ favoriteMovie: "Heat" });
    expect(await (await get("/onboarding", cookie)).text()).toContain("/dashboard");
  });
});

describe("fact generation (Variant A)", () => {
  it("generates and stores a fact, then serves it from cache within 60s", async () => {
    const user = await createSignedInUser({ favoriteMovie: "Alien" });
    const before = await stub.calls();

    const first = await fact(user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.source).toBe("generated");
    expect(first.body.fact.content).toContain("Movie title: Alien");
    expect(await prisma.movieFact.count({ where: { userId: user.id } })).toBe(1);

    const second = await fact(user.cookie);
    expect(second.body).toEqual({ ...first.body, source: "cache" });
    expect(await stub.calls()).toBe(before + 1);
  });

  it("regenerates once the latest fact is 60s old", async () => {
    const user = await createSignedInUser({ favoriteMovie: "Alien" });
    await fact(user.cookie);
    await prisma.movieFact.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 60_000) } });

    const res = await fact(user.cookie);

    expect(res.body.source).toBe("generated");
    expect(await prisma.movieFact.count({ where: { userId: user.id } })).toBe(2);
  });

  it("makes one OpenAI call for a burst of concurrent requests", async () => {
    const user = await createSignedInUser({ favoriteMovie: "Jaws" });
    await stub.set({ delayMs: 400 });
    const before = await stub.calls();

    const results = await Promise.all(Array.from({ length: 6 }, () => fact(user.cookie)));

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.fact.content)).size).toBe(1);
    expect(await stub.calls()).toBe(before + 1);
    expect(await prisma.movieFact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("falls back to the last fact when OpenAI fails", async () => {
    const user = await createSignedInUser({ favoriteMovie: "Up" });
    const original = await fact(user.cookie);
    await prisma.movieFact.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await stub.set({ mode: "fail" });

    const res = await fact(user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("stale-fallback");
    expect(res.body.fact.content).toBe(original.body.fact.content);
  });

  it("returns a friendly 503 when OpenAI fails and there is no fact yet", async () => {
    const user = await createSignedInUser({ favoriteMovie: "Up" });
    await stub.set({ mode: "fail" });

    const res = await fact(user.cookie);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/try again/i);
  });
});

describe("authorization", () => {
  it("never returns another user's fact, even for the same movie or with a userId param", async () => {
    const alice = await createSignedInUser({ favoriteMovie: "Psycho" });
    const bob = await createSignedInUser({ favoriteMovie: "Psycho" });
    const alicesFact = (await fact(alice.cookie)).body.fact.content;

    const bobs = await fact(bob.cookie, `?userId=${alice.id}`);

    expect(bobs.status).toBe(200);
    expect(bobs.body.fact.content).not.toBe(alicesFact);
    expect(await prisma.movieFact.count({ where: { userId: bob.id } })).toBe(1);
  });

  it("stops working as soon as the session is gone (logout)", async () => {
    const user = await createSignedInUser({ favoriteMovie: "Heat" });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    expect((await get("/api/fact", user.cookie)).status).toBe(401);
  });
});
