import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { systemSettingsRepository } from "../db/repositories/system-settings.repository";

export const authRoutes = new Hono();

export function getEffectiveOAuthConfig() {
  const globalSettings = systemSettingsRepository.getGlobalSettings();
  const clientId = globalSettings?.githubClientId || process.env.GITHUB_CLIENT_ID || "";
  const clientSecret = globalSettings?.githubClientSecret || process.env.GITHUB_CLIENT_SECRET || "";
  return { clientId, clientSecret };
}

export function getSessionUser(c: any): { username: string; accessToken?: string; isAdmin: boolean } | null {
  const cookieStr = getCookie(c, "pikiland_session");
  if (!cookieStr) {
    if (process.env.DEBUG === "true" || process.env.PIKILAND_DEBUG === "true") {
      return { username: "local-dev-user", accessToken: undefined, isAdmin: true };
    }
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(cookieStr, "base64").toString("utf-8"));
    const adminUsers = (process.env.PIKILAND_ADMIN_USERS || "").split(",").map((u) => u.trim().toLowerCase());
    const isDebug = process.env.DEBUG === "true" || process.env.PIKILAND_DEBUG === "true";
    const isAdmin = isDebug || (session.username && adminUsers.includes(session.username.toLowerCase()));

    return {
      username: session.username,
      accessToken: session.accessToken,
      isAdmin,
    };
  } catch (e) {
    return null;
  }
}

// Redirect to GitHub OAuth
function handleLoginRedirect(c: any) {
  const { clientId } = getEffectiveOAuthConfig();
  if (!clientId) {
    return c.redirect("/dashboard");
  }
  const redirectUri = `${new URL(c.req.url).origin}/login/oauth2/code/github`;
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=read:user,repo&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return c.redirect(githubAuthUrl);
}

authRoutes.get("/login", handleLoginRedirect);
authRoutes.get("/oauth2/authorization/github", handleLoginRedirect);

// OAuth Callback
async function handleOAuthCallback(c: any) {
  const code = c.req.query("code");
  if (!code) {
    return c.redirect("/setup");
  }

  const { clientId, clientSecret } = getEffectiveOAuthConfig();
  if (!clientId || !clientSecret) {
    return c.redirect("/dashboard");
  }

  try {
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData: any = await tokenResp.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return c.redirect("/setup");
    }

    const userResp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "PikiLand-Coordinator",
        Accept: "application/vnd.github+json",
      },
    });

    const userData: any = await userResp.json();
    const username = userData.login || "anonymous";

    const sessionPayload = Buffer.from(JSON.stringify({ username, accessToken })).toString("base64");
    setCookie(c, "pikiland_session", sessionPayload, {
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      sameSite: "Lax",
    });

    return c.redirect("/dashboard");
  } catch (e: any) {
    console.error("[Auth] OAuth exchange failed:", e.message);
    return c.redirect("/setup");
  }
}

authRoutes.get("/auth/github/callback", handleOAuthCallback);
authRoutes.get("/login/oauth2/code/github", handleOAuthCallback);

authRoutes.get("/logout", (c) => {
  deleteCookie(c, "pikiland_session", { path: "/" });
  return c.redirect("/");
});
