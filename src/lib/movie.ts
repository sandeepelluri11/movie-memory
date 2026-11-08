import { z } from "zod";

export const MOVIE_MIN_LENGTH = 1;
export const MOVIE_MAX_LENGTH = 100;

export const favoriteMovieSchema = z
  .string({ error: "Please enter a movie title." })
  // Collapse internal whitespace so "The  Matrix " and "The Matrix" are the same movie.
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(MOVIE_MIN_LENGTH, "Please enter a movie title.")
      .max(MOVIE_MAX_LENGTH, `Movie title must be at most ${MOVIE_MAX_LENGTH} characters.`)
      .refine((s) => !/[\p{Cc}]/u.test(s), "Movie title contains invalid characters."),
  );

export type ValidationResult = { ok: true; movie: string } | { ok: false; error: string };

export function validateFavoriteMovie(input: unknown): ValidationResult {
  const result = favoriteMovieSchema.safeParse(input);
  if (result.success) return { ok: true, movie: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Invalid movie title." };
}
