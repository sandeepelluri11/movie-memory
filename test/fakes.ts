import type { FactRepository, StoredFact } from "@/lib/facts/service";

type FakeUser = { favoriteMovie: string | null; leaseAt: Date | null };
type FakeFact = StoredFact & { userId: string };

/** In-memory FactRepository with the same semantics as the Prisma one (JS is single-threaded, so each op is atomic). */
export function createInMemoryFactRepository() {
  const users = new Map<string, FakeUser>();
  const facts: FakeFact[] = [];
  let nextId = 1;

  const strip = ({ id, movie, content, createdAt }: FakeFact): StoredFact => ({ id, movie, content, createdAt });

  const repo: FactRepository = {
    async getFavoriteMovie(userId) {
      return users.get(userId)?.favoriteMovie ?? null;
    },
    async findLatestFact(userId, movie) {
      const latest = facts
        .filter((f) => f.userId === userId && f.movie === movie)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return latest ? strip(latest) : null;
    },
    async createFact(input) {
      const fact = { id: `fact-${nextId++}`, ...input };
      facts.push(fact);
      return strip(fact);
    },
    async tryAcquireGenerationLease(userId, acquiredAt, staleBefore) {
      const user = users.get(userId);
      if (!user || (user.leaseAt && user.leaseAt >= staleBefore)) return false;
      user.leaseAt = acquiredAt;
      return true;
    },
    async isGenerationLeaseHeld(userId, staleBefore) {
      const leaseAt = users.get(userId)?.leaseAt;
      return !!leaseAt && leaseAt >= staleBefore;
    },
    async releaseGenerationLease(userId, acquiredAt) {
      const user = users.get(userId);
      if (user?.leaseAt?.getTime() === acquiredAt.getTime()) user.leaseAt = null;
    },
  };

  return {
    repo,
    facts,
    users,
    addUser(id: string, favoriteMovie: string | null) {
      users.set(id, { favoriteMovie, leaseAt: null });
    },
    addFact(userId: string, movie: string, content: string, createdAt: Date) {
      const fact = { id: `fact-${nextId++}`, userId, movie, content, createdAt };
      facts.push(fact);
      return strip(fact);
    },
  };
}

export function createFakeClock(start = new Date("2026-01-01T12:00:00Z")) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
    ago: (ms: number) => new Date(t - ms),
  };
}
