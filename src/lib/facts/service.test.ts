import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClock, createInMemoryFactRepository } from "../../../test/fakes";
import {
  CACHE_WINDOW_MS,
  createFactService,
  FactUnavailableError,
  GENERATION_LEASE_MS,
  NoFavoriteMovieError,
  type FactGenerator,
} from "./service";

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(generateFact: FactGenerator = vi.fn(async (movie: string) => `fact about ${movie}`)) {
  const store = createInMemoryFactRepository();
  const clock = createFakeClock();
  const service = createFactService({
    repo: store.repo,
    generateFact,
    now: clock.now,
    sleep: yieldToEventLoop,
    logError: () => {},
  });
  return { store, clock, service, generateFact };
}

describe("60-second cache window", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.store.addUser("alice", "Alien");
  });

  it("generates and stores a fact when none exists", async () => {
    const result = await ctx.service.getFactForUser("alice");

    expect(result.source).toBe("generated");
    expect(result.fact.content).toBe("fact about Alien");
    expect(ctx.generateFact).toHaveBeenCalledOnce();
    expect(ctx.store.facts).toHaveLength(1);
    expect(ctx.store.facts[0]).toMatchObject({ userId: "alice", movie: "Alien" });
  });

  it("returns the cached fact when it is less than 60 seconds old", async () => {
    const cached = ctx.store.addFact("alice", "Alien", "cached", ctx.clock.ago(CACHE_WINDOW_MS - 1));

    const result = await ctx.service.getFactForUser("alice");

    expect(result).toEqual({ fact: cached, source: "cache" });
    expect(ctx.generateFact).not.toHaveBeenCalled();
  });

  it("generates a new fact once the latest one is exactly 60 seconds old", async () => {
    ctx.store.addFact("alice", "Alien", "old", ctx.clock.ago(CACHE_WINDOW_MS));

    const result = await ctx.service.getFactForUser("alice");

    expect(result.source).toBe("generated");
    expect(result.fact.content).toBe("fact about Alien");
    expect(ctx.store.facts).toHaveLength(2);
  });

  it("serves from cache within the window and regenerates after it", async () => {
    const first = await ctx.service.getFactForUser("alice");

    ctx.clock.advance(30_000);
    expect(await ctx.service.getFactForUser("alice")).toEqual({ fact: first.fact, source: "cache" });

    ctx.clock.advance(30_000);
    const third = await ctx.service.getFactForUser("alice");
    expect(third.source).toBe("generated");
    expect(third.fact.id).not.toBe(first.fact.id);
    expect(ctx.generateFact).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a fresh fact about a different movie", async () => {
    ctx.store.addFact("alice", "Heat", "about Heat", ctx.clock.ago(1_000));

    const result = await ctx.service.getFactForUser("alice");

    expect(result.source).toBe("generated");
    expect(result.fact.movie).toBe("Alien");
  });

  it("throws NoFavoriteMovieError when the user has no movie", async () => {
    ctx.store.addUser("bob", null);
    await expect(ctx.service.getFactForUser("bob")).rejects.toBeInstanceOf(NoFavoriteMovieError);
  });
});

describe("authorization / user scoping", () => {
  it("never returns another user's fact, even a fresh one for the same movie", async () => {
    const { store, clock, service } = setup();
    store.addUser("alice", "Alien");
    store.addUser("bob", "Alien");
    const bobsFact = store.addFact("bob", "Alien", "bob's fact", clock.ago(1_000));

    const result = await service.getFactForUser("alice");

    expect(result.source).toBe("generated");
    expect(result.fact.id).not.toBe(bobsFact.id);
    expect(store.facts.filter((f) => f.userId === "alice")).toHaveLength(1);
  });
});

describe("burst protection", () => {
  it("generates only once when many requests arrive concurrently", async () => {
    let resolveGeneration!: (fact: string) => void;
    const generateFact = vi.fn(() => new Promise<string>((resolve) => (resolveGeneration = resolve)));
    const { store, service } = setup(generateFact);
    store.addUser("alice", "Alien");

    const requests = Array.from({ length: 5 }, () => service.getFactForUser("alice"));
    await vi.waitFor(() => expect(generateFact).toHaveBeenCalledOnce());
    resolveGeneration("the one fact");
    const results = await Promise.all(requests);

    expect(generateFact).toHaveBeenCalledOnce();
    expect(store.facts).toHaveLength(1);
    expect(new Set(results.map((r) => r.fact.id)).size).toBe(1);
  });

  it("takes over a lease abandoned by a crashed request", async () => {
    const { store, clock, service, generateFact } = setup();
    store.addUser("alice", "Alien");
    store.users.get("alice")!.leaseAt = clock.ago(GENERATION_LEASE_MS + 1);

    const result = await service.getFactForUser("alice");

    expect(result.source).toBe("generated");
    expect(generateFact).toHaveBeenCalledOnce();
    expect(store.users.get("alice")!.leaseAt).toBeNull();
  });
});

describe("OpenAI failure handling", () => {
  const failing = () => vi.fn(async () => Promise.reject(new Error("timeout")));

  it("falls back to the most recent (stale) fact", async () => {
    const { store, clock, service } = setup(failing());
    store.addUser("alice", "Alien");
    const old = store.addFact("alice", "Alien", "old fact", clock.ago(5 * 60_000));

    expect(await service.getFactForUser("alice")).toEqual({ fact: old, source: "stale-fallback" });
  });

  it("throws a user-friendly error when there is nothing to fall back to", async () => {
    const { store, service } = setup(failing());
    store.addUser("alice", "Alien");

    await expect(service.getFactForUser("alice")).rejects.toBeInstanceOf(FactUnavailableError);
  });

  it("releases the lease after a failure so the next request can retry", async () => {
    const { store, service } = setup(failing());
    store.addUser("alice", "Alien");

    await service.getFactForUser("alice").catch(() => {});

    expect(store.users.get("alice")!.leaseAt).toBeNull();
  });
});
