import type { Context } from "hono";
import { z } from "zod";

export type AppContext = Context<{ Bindings: Env }>;

export const Incident = z.object({
  id: z.uuid(),
  repo_name: z.string(),
  finished: z.boolean().default(false),
});
