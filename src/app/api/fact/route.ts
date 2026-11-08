import { getSessionUserId } from "@/auth";
import { factService } from "@/lib/facts";
import type { ErrorResponse, FactResponse } from "@/lib/facts/api-types";
import { FactUnavailableError, NoFavoriteMovieError } from "@/lib/facts/service";

// The user is always taken from the session; this route accepts no user id, so it
// is impossible to request another user's facts.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated." } satisfies ErrorResponse, { status: 401 });

  try {
    const { fact, source } = await factService.getFactForUser(userId);
    const body: FactResponse = {
      fact: { content: fact.content, movie: fact.movie, createdAt: fact.createdAt.toISOString() },
      source,
    };
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof NoFavoriteMovieError) {
      return Response.json({ error: "Set a favorite movie first." } satisfies ErrorResponse, { status: 409 });
    }
    if (err instanceof FactUnavailableError) {
      return Response.json({ error: err.message } satisfies ErrorResponse, { status: 503 });
    }
    console.error("Unexpected error in GET /api/fact", err);
    return Response.json({ error: "Something went wrong." } satisfies ErrorResponse, { status: 500 });
  }
}
