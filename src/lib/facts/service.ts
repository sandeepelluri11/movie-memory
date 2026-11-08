export const CACHE_WINDOW_MS = 60_000;
// Must exceed the OpenAI timeout so a live generation is never considered abandoned.
export const GENERATION_LEASE_MS = 30_000;
export const WAIT_FOR_IN_FLIGHT_MS = 15_000;
export const POLL_INTERVAL_MS = 500;

export type StoredFact = {
  id: string;
  movie: string;
  content: string;
  createdAt: Date;
};

export type FactSource = "cache" | "generated" | "stale-fallback";

export type FactResult = { fact: StoredFact; source: FactSource };

export interface FactRepository {
  getFavoriteMovie(userId: string): Promise<string | null>;
  /** Latest fact for this user AND movie. Must be scoped by userId. */
  findLatestFact(userId: string, movie: string): Promise<StoredFact | null>;
  createFact(input: { userId: string; movie: string; content: string; createdAt: Date }): Promise<StoredFact>;
  /** Atomically claims the lease if it is free or older than `staleBefore`. */
  tryAcquireGenerationLease(userId: string, acquiredAt: Date, staleBefore: Date): Promise<boolean>;
  isGenerationLeaseHeld(userId: string, staleBefore: Date): Promise<boolean>;
  /** Releases only if we still own the lease (identified by acquiredAt). */
  releaseGenerationLease(userId: string, acquiredAt: Date): Promise<void>;
}

export type FactGenerator = (movie: string) => Promise<string>;

export class NoFavoriteMovieError extends Error {
  constructor() {
    super("No favorite movie set.");
    this.name = "NoFavoriteMovieError";
  }
}

export class FactUnavailableError extends Error {
  constructor(message = "We couldn't come up with a fun fact right now. Please try again in a moment.") {
    super(message);
    this.name = "FactUnavailableError";
  }
}

export function isFresh(fact: StoredFact, now: Date): boolean {
  return now.getTime() - fact.createdAt.getTime() < CACHE_WINDOW_MS;
}

type Deps = {
  repo: FactRepository;
  generateFact: FactGenerator;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  logError?: (message: string, err: unknown) => void;
};

export function createFactService({
  repo,
  generateFact,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // Message only: SDK errors carry full response headers, which just add noise.
  logError = (message, err) => console.error(`${message}: ${err instanceof Error ? err.message : String(err)}`),
}: Deps) {
  const leaseStaleBefore = () => new Date(now().getTime() - GENERATION_LEASE_MS);

  async function waitForInFlightGeneration(
    userId: string,
    movie: string,
    previous: StoredFact | null,
  ): Promise<FactResult> {
    const deadline = now().getTime() + WAIT_FOR_IN_FLIGHT_MS;
    while (now().getTime() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const latest = await repo.findLatestFact(userId, movie);
      if (latest && isFresh(latest, now())) return { fact: latest, source: "cache" };
      if (!(await repo.isGenerationLeaseHeld(userId, leaseStaleBefore()))) break;
    }
    // The holder may have committed a fact right before releasing the lease.
    const latest = (await repo.findLatestFact(userId, movie)) ?? previous;
    if (latest && isFresh(latest, now())) return { fact: latest, source: "cache" };
    if (latest) return { fact: latest, source: "stale-fallback" };
    throw new FactUnavailableError();
  }

  async function getFactForUser(userId: string): Promise<FactResult> {
    const movie = await repo.getFavoriteMovie(userId);
    if (!movie) throw new NoFavoriteMovieError();

    const latest = await repo.findLatestFact(userId, movie);
    if (latest && isFresh(latest, now())) return { fact: latest, source: "cache" };

    const acquiredAt = now();
    const acquired = await repo.tryAcquireGenerationLease(userId, acquiredAt, leaseStaleBefore());
    if (!acquired) return waitForInFlightGeneration(userId, movie, latest);

    try {
      // Another request may have finished generating between our first read and taking the lease.
      const current = (await repo.findLatestFact(userId, movie)) ?? latest;
      if (current && isFresh(current, now())) return { fact: current, source: "cache" };

      let content: string;
      try {
        content = await generateFact(movie);
      } catch (err) {
        logError("Fact generation failed", err);
        if (current) return { fact: current, source: "stale-fallback" };
        throw new FactUnavailableError();
      }

      const fact = await repo.createFact({ userId, movie, content, createdAt: now() });
      return { fact, source: "generated" };
    } finally {
      // A failed release is harmless: the lease expires after GENERATION_LEASE_MS.
      await repo.releaseGenerationLease(userId, acquiredAt).catch((err) => logError("Lease release failed", err));
    }
  }

  return { getFactForUser };
}

export type FactService = ReturnType<typeof createFactService>;
