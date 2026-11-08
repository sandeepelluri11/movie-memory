import "server-only";
import { prisma } from "@/lib/db";
import { createOpenAIFactGenerator } from "./openai-generator";
import { createPrismaFactRepository } from "./prisma-repository";
import { createFactService } from "./service";

export const factService = createFactService({
  repo: createPrismaFactRepository(prisma),
  generateFact: createOpenAIFactGenerator(),
});
