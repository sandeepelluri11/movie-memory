import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaFactRepository } from "./prisma-repository";
import { GENERATION_LEASE_MS } from "./service";

// Runs against a real Postgres (npm run test:db) to prove the lease is atomic under concurrency.
describe.skipIf(!process.env.RUN_DB_TESTS)("Prisma generation lease (Postgres)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const repo = createPrismaFactRepository(prisma);
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `lease-test-${Date.now()}@example.com`, favoriteMovie: "Alien" } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("grants the lease to exactly one of many concurrent callers", async () => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - GENERATION_LEASE_MS);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => repo.tryAcquireGenerationLease(userId, new Date(now.getTime() + i), staleBefore)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repo.isGenerationLeaseHeld(userId, staleBefore)).toBe(true);
  });

  it("does not let a non-owner release the lease", async () => {
    const staleBefore = new Date(Date.now() - GENERATION_LEASE_MS);
    await repo.releaseGenerationLease(userId, new Date(0));
    expect(await repo.isGenerationLeaseHeld(userId, staleBefore)).toBe(true);
  });

  it("only returns facts belonging to the requested user", async () => {
    const other = await prisma.user.create({ data: { email: `other-${Date.now()}@example.com`, favoriteMovie: "Alien" } });
    try {
      await repo.createFact({ userId: other.id, movie: "Alien", content: "not yours", createdAt: new Date() });
      expect(await repo.findLatestFact(userId, "Alien")).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});
