import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUserId: vi.fn<() => Promise<string | null>>(),
  updateMany: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/auth", () => ({ getSessionUserId: mocks.getSessionUserId, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { updateMany: mocks.updateMany } } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { saveFavoriteMovie } = await import("./actions");

const initial = { error: null, value: "" };
const form = (movie?: string | Blob) => {
  const fd = new FormData();
  if (movie !== undefined) fd.set("movie", movie);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("saveFavoriteMovie", () => {
  it("redirects to the landing page when not signed in, without writing", async () => {
    mocks.getSessionUserId.mockResolvedValue(null);

    await expect(saveFavoriteMovie(initial, form("Alien"))).rejects.toThrow("REDIRECT:/");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "    "],
    ["too long", "x".repeat(101)],
  ])("returns a validation error for %s input and keeps what the user typed", async (_label, movie) => {
    mocks.getSessionUserId.mockResolvedValue("alice");

    const state = await saveFavoriteMovie(initial, form(movie));

    expect(state.error).toBeTruthy();
    expect(state.value).toBe(movie);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-text field", async () => {
    mocks.getSessionUserId.mockResolvedValue("alice");

    expect((await saveFavoriteMovie(initial, form())).error).toBeTruthy();
    expect((await saveFavoriteMovie(initial, form(new Blob(["x"])))).error).toBeTruthy();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("saves the normalized title for the session user only, never overwriting, then redirects", async () => {
    mocks.getSessionUserId.mockResolvedValue("alice");

    await expect(saveFavoriteMovie(initial, form("  The   Matrix "))).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "alice", favoriteMovie: null },
      data: { favoriteMovie: "The Matrix" },
    });
  });
});
