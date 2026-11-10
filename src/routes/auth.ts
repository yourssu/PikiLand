import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { sign } from "hono/jwt";

const auth = new Hono<{ Bindings: CloudflareBindings }>();

auth.get("/github", async (c) => {
  const { DB } = c.env;

  await DB.exec("DELETE FROM oauth_states WHERE expires_at < datetime('now')");

  const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  await DB.prepare(
    "INSERT INTO oauth_states VALUES (?, datetime('now', '+10 minutes'))",
  )
    .bind(state)
    .run();

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set(
    "redirect_uri",
    new URL("/auth/github/callback", c.env.BASE_URL).toString(),
  );
  url.searchParams.set("state", state);

  return c.redirect(url);
});

auth.get("/github/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");

  if (!state || !code) {
    return c.text("Invalid OAuth request", 400);
  }

  const { DB } = c.env;

  const validState = await DB.prepare(
    "DELETE FROM oauth_states WHERE state = ? AND expires_at > datetime('now') RETURNING state",
  )
    .bind(state)
    .first<{ state: string }>();

  if (!validState) {
    return c.text("Invalid state", 400);
  }

  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    },
  );

  const tokenData = (await tokenResponse.json()) as {
    access_token?: unknown;
  };
  const accessToken = tokenData.access_token;

  if (!tokenResponse.ok || typeof accessToken !== "string") {
    return c.text("GitHub code exchange failed", 502);
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "PikiLand-Coordinator",
    },
  });

  if (!userResponse.ok) {
    return c.text("Failed to get GitHub user info", 502);
  }

  const { id } = (await userResponse.json()) as {
    id?: unknown;
  };

  if (typeof id !== "number") {
    return c.text("Invalid GitHub user info", 502);
  }

  await DB.prepare(
    `REPLACE INTO sessions VALUES (?, ?, datetime('now', '+8 hours'))`,
  )
    .bind(id, tokenData.access_token)
    .run();

  const token = await sign(
    {
      id,
      exp: Math.floor(Date.now() / 1000) + 28800,
    },
    c.env.JWT_SECRET,
    "HS256",
  );

  setCookie(c, "__Host-token", token, {
    httpOnly: true,
    maxAge: 28800,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });

  return c.redirect("/dashboard");
});

export default auth;
