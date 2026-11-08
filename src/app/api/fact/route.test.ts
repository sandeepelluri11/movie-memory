import { beforeEach, describe, expect, it, vi } from "vitest";
import { FactUnavailableError, NoFavoriteMovieError } from "@/lib/facts/service";

const mocks = vi.hoisted(() => ({
  getSessionUserId: vi.fn<() => Promise<string | null>>(),
  getFactForUser: vi.fn(),
}));

vi.mock("@/auth", () => ({ getSessionUserId: mocks.getSessionUserId }));
vi.mock("@/lib/facts", () => ({ factService: { getFactForUser: mocks.getFactForUser } }));

const { GET } = await import("./route");

const fact = { id: "f1", movie: "Alien", content: "A fun fact", createdAt: new Date("2026-01-01T00:00:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/fact", () => {
  it("returns 401 and never touches facts when unauthenticated", async () => {
    mocks.getSessionUserId.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mocks.getFactForUser).not.toHaveBeenCalled();
  });

  it("only fetches facts for the session user", async () => {
    mocks.getSessionUserId.mockResolvedValue("alice");
    mocks.getFactForUser.mockResolvedValue({ fact, source: "cache" });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(mocks.getFactForUser).toHaveBeenCalledExactlyOnceWith("alice");
    expect(await res.json()).toEqual({
      fact: { content: "A fun fact", movie: "Alien", createdAt: "2026-01-01T00:00:00.000Z" },
      source: "cache",
    });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("maps a generation failure to a friendly 503", async () => {
    mocks.getSessionUserId.mockResolvedValue("alice");
    mocks.getFactForUser.mockRejectedValue(new FactUnavailableError());

    const res = await GET();

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/try again/i);
  });

  it("returns 409 when the user has not completed onboarding", async () => {
    mocks.getSessionUserId.mockResolvedValue("alice");
    mocks.getFactForUser.mockRejectedValue(new NoFavoriteMovieError());

    expect((await GET()).status).toBe(409);
  });

  it("hides unexpected errors behind a generic 500", async () => {
    mocks.getSessionUserId.mockResolvedValue("alice");
    mocks.getFactForUser.mockRejectedValue(new Error("connection refused at 10.0.0.5"));

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong." });
  });
});
