import { Hono, Next } from "hono";
import { fromHono } from "chanfana";
import auth from "./routes/auth";
import { GetCurrentUser } from "./endpoints/getCurrentUser";
import { AppContext, Env } from "./types";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";

const app = new Hono<Env>();

app.route("/auth", auth);

const openapi = fromHono(app, {
  base: "/api",
  docs_url: "/",
  schema: {
    info: { title: "PikiLand API", version: "0.1.0" },
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

openapi.use("/users/*", jwtMiddleware);

openapi.get("/users/me", GetCurrentUser);

export default app;
