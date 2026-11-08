import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FactRepository } from "./service";

const factSelect = { id: true, movie: true, content: true, createdAt: true } as const;

export function createPrismaFactRepository(prisma: PrismaClient): FactRepository {
  return {
    async getFavoriteMovie(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { favoriteMovie: true } });
      return user?.favoriteMovie ?? null;
    },

    findLatestFact(userId, movie) {
      return prisma.movieFact.findFirst({
        where: { userId, movie },
        orderBy: { createdAt: "desc" },
        select: factSelect,
      });
    },

    createFact({ userId, movie, content, createdAt }) {
      return prisma.movieFact.create({ data: { userId, movie, content, createdAt }, select: factSelect });
    },

    // A single conditional UPDATE is atomic in Postgres: concurrent callers re-check the
    // WHERE clause after the winner commits, so exactly one of them gets count === 1.
    async tryAcquireGenerationLease(userId, acquiredAt, staleBefore) {
      const { count } = await prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ factGenerationStartedAt: null }, { factGenerationStartedAt: { lt: staleBefore } }],
        },
        data: { factGenerationStartedAt: acquiredAt },
      });
      return count === 1;
    },

    async isGenerationLeaseHeld(userId, staleBefore) {
      const held = await prisma.user.count({
        where: { id: userId, factGenerationStartedAt: { gte: staleBefore } },
      });
      return held > 0;
    },

    async releaseGenerationLease(userId, acquiredAt) {
      await prisma.user.updateMany({
        where: { id: userId, factGenerationStartedAt: acquiredAt },
        data: { factGenerationStartedAt: null },
      });
    },
  };
}
