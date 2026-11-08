import { describe, expect, it } from "vitest";
import { MOVIE_MAX_LENGTH, validateFavoriteMovie } from "./movie";

describe("validateFavoriteMovie", () => {
  it("trims and collapses whitespace", () => {
    expect(validateFavoriteMovie("  The   Matrix ")).toEqual({ ok: true, movie: "The Matrix" });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["too long", "x".repeat(MOVIE_MAX_LENGTH + 1)],
    ["control characters", "Alien\u0000"],
    ["non-string", null],
  ])("rejects %s input", (_label, input) => {
    expect(validateFavoriteMovie(input).ok).toBe(false);
  });

  it("accepts a single-character title and the max length", () => {
    expect(validateFavoriteMovie("M").ok).toBe(true);
    expect(validateFavoriteMovie("x".repeat(MOVIE_MAX_LENGTH)).ok).toBe(true);
  });
});
