import type { FactSource } from "./service";

export type FactResponse = {
  fact: { content: string; movie: string; createdAt: string };
  source: FactSource;
};

export type ErrorResponse = { error: string };
