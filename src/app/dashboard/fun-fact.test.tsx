// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FunFact } from "./fun-fact";

const replace = vi.fn();
// Must be a stable object, like Next's real router; a fresh one per render would re-trigger the fetch effect.
const router = { replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const fact = (source: string, content = "Sharks can't stop swimming.") => ({
  fact: { content, movie: "Jaws", createdAt: "2026-01-01T00:00:00.000Z" },
  source,
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("FunFact", () => {
  it("shows a loading state, then the fact", async () => {
    fetchMock.mockReturnValueOnce(json(fact("generated")));

    render(<FunFact />);

    expect(screen.getByText(/finding a fun fact/i)).toBeTruthy();
    expect(await screen.findByText("Sharks can't stop swimming.")).toBeTruthy();
    expect(screen.getByText(/at most once a minute/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/fact", expect.objectContaining({ cache: "no-store" }));
  });

  it("tells the user when it is showing an older fact", async () => {
    fetchMock.mockReturnValueOnce(json(fact("stale-fallback")));

    render(<FunFact />);

    expect(await screen.findByText(/here's a recent one/i)).toBeTruthy();
  });

  it("shows the server's friendly error message", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "We couldn't come up with a fun fact right now." }, 503));

    render(<FunFact />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't come up with a fun fact/i);
  });

  it("shows a generic message when the network fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<FunFact />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't reach the server/i);
  });

  it("sends the user to the landing page when the session has expired", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "Not authenticated." }, 401));

    render(<FunFact />);

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("refetches when Refresh is clicked", async () => {
    fetchMock.mockReturnValueOnce(json(fact("generated", "first"))).mockReturnValueOnce(json(fact("generated", "second")));

    render(<FunFact />);
    await screen.findByText("first");
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("second")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
