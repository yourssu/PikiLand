import { Context } from "hono";

export type Env = { Bindings: CloudflareBindings; Variables: { id: number } };

export type AppContext = Context<Env>;
