import { CreateEngineToken } from "./endpoints/engineToken";
import {
  ListIncidents,
  GetIncident,
  DeleteIncident,
  UpdateEngineIncident,
} from "./endpoints/incidents";
import { Hono, Next } from "hono";
import { fromHono } from "chanfana";
import auth from "./routes/auth";
import { GetCurrentUser } from "./endpoints/getCurrentUser";
import {
  CreateRepository,
  GetRepository,
  UpdateRepository,
  DeleteRepository,
} from "./endpoints/repository";
import { ListRepositories } from "./endpoints/listRepositories";
import { AppContext, Env } from "./types";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";

declare const __API_DOCS__: boolean;

const app = new Hono<Env>();

app.route("/auth", auth);

const openapi = fromHono(app, {
  base: "/api",
  docs_url: "/",
  redoc_url: null,
  openapi_url: "/openapi.json",
  schema: {
    info: { title: "PikiLand API", version: "0.0.0-v2" },
    tags: [
      { name: "users" },
      { name: "repositories" },
      { name: "incidents" },
      { name: "engine" },
    ],
  },
});

openapi.registry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "__Host-token",
});

openapi.registry.registerComponent("securitySchemes", "RepositoryBearer", {
  type: "http",
  scheme: "bearer",
  description: "피키랜드 engine 토큰",
});
openapi.registry.registerComponent("securitySchemes", "GitHubActionsOIDC", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// These routes authenticate independently of the user cookie middleware.
openapi.post("/repositories/:repo_id/tokens/engine", CreateEngineToken);
openapi.post("/repositories/:repo_id/incidents", UpdateEngineIncident);

const jwtMiddleware = async (c: AppContext, next: Next) => {
  const unauthorizedResponse = c.text("Unauthorized", 401);
  const token = getCookie(c, "token", "host");
  if (!token) return unauthorizedResponse;
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    const { id } = payload;
    if (typeof id !== "number" || !Number.isSafeInteger(id))
      return unauthorizedResponse;
    c.set("id", id);
  } catch {
    return unauthorizedResponse;
  }
  await next();
};
openapi.use("/*", jwtMiddleware);

openapi.get("/users/me", GetCurrentUser);
openapi.get("/repositories", ListRepositories);
openapi.post("/repositories", CreateRepository);
openapi.get("/repositories/:repo_id", GetRepository);
openapi.post("/repositories/:repo_id", UpdateRepository);
openapi.delete("/repositories/:repo_id", DeleteRepository);

openapi.get("/repositories/:repo_id/incidents", ListIncidents);
openapi.get("/repositories/:repo_id/incidents/:incident_id", GetIncident);
openapi.delete("/repositories/:repo_id/incidents/:incident_id", DeleteIncident);

export default app;
