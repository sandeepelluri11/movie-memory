import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaFactRepository } from "./prisma-repository";
import { CACHE_WINDOW_MS, createFactService, FactUnavailableError, type FactGenerator } from "./service";

// Full fact service against a real Postgres (npm run test:db). Only OpenAI is faked.
describe.skipIf(!process.env.RUN_DB_TESTS)("fact service + Postgres", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const repo = createPrismaFactRepository(prisma);
  const createdUserIds: string[] = [];

  async function createUser(favoriteMovie: string) {
    const user = await prisma.user.create({
      data: { email: `svc-${crypto.randomUUID()}@example.com`, favoriteMovie },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  function service(generateFact: FactGenerator, now?: () => Date) {
    return createFactService({ repo, generateFact, now, sleep: (ms) => new Promise((r) => setTimeout(r, ms / 10)), logError: () => {} });
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("stores a generated fact, serves it from cache inside 60s, and regenerates after", async () => {
    const userId = await createUser("Alien");
    let t = Date.now();
    const generate = vi.fn(async () => `fact #${generate.mock.calls.length}`);
    const svc = service(generate, () => new Date(t));

    const first = await svc.getFactForUser(userId);
    expect(first.source).toBe("generated");
    expect(await prisma.movieFact.count({ where: { userId } })).toBe(1);

    t += CACHE_WINDOW_MS - 1;
    expect(await svc.getFactForUser(userId)).toEqual({ fact: first.fact, source: "cache" });

    t += 1;
    const third = await svc.getFactForUser(userId);
    expect(third.source).toBe("generated");
    expect(third.fact.id).not.toBe(first.fact.id);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await prisma.movieFact.count({ where: { userId } })).toBe(2);
  });

  it("generates exactly once for 10 concurrent requests", async () => {
    const userId = await createUser("Heat");
    const generate = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return "the only fact";
    });
    const svc = service(generate);

    const results = await Promise.all(Array.from({ length: 10 }, () => svc.getFactForUser(userId)));

    expect(generate).toHaveBeenCalledOnce();
    expect(await prisma.movieFact.count({ where: { userId } })).toBe(1);
    expect(new Set(results.map((r) => r.fact.id)).size).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.factGenerationStartedAt).toBeNull();
  });

  it("never serves another user's fact for the same movie", async () => {
    const alice = await createUser("Up");
    const bob = await createUser("Up");
    await service(async () => "bob's fact").getFactForUser(bob);

    const result = await service(async () => "alice's fact").getFactForUser(alice);

    expect(result.fact.content).toBe("alice's fact");
  });

  it("falls back to the stale fact when generation fails, and releases the lease", async () => {
    const userId = await createUser("Jaws");
    let t = Date.now();
    await service(async () => "old fact", () => new Date(t)).getFactForUser(userId);
    t += CACHE_WINDOW_MS * 5;

    const failing = service(async () => Promise.reject(new Error("timeout")), () => new Date(t));
    const result = await failing.getFactForUser(userId);

    expect(result).toMatchObject({ source: "stale-fallback", fact: { content: "old fact" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.factGenerationStartedAt).toBeNull();
  });

  it("returns a friendly error when generation fails and there is no fact yet", async () => {
    const userId = await createUser("Psycho");
    await expect(
      service(async () => Promise.reject(new Error("boom"))).getFactForUser(userId),
    ).rejects.toBeInstanceOf(FactUnavailableError);
  });
});
