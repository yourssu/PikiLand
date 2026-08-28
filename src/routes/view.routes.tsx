import { Hono } from "hono";
import { IndexPage } from "../views/index";
import { DashboardPage } from "../views/dashboard";
import { AdminPage } from "../views/admin";
import { SetupPage } from "../views/setup";
import { getSessionUser } from "./auth.routes";
import { dashboardService } from "../services/dashboard.service";

export const viewRoutes = new Hono();

viewRoutes.get("/", (c) => {
  return c.html(<IndexPage />);
});

viewRoutes.get("/dashboard", async (c) => {
  const user = getSessionUser(c);
  const username = user?.username || "anonymous";
  const isAdmin = Boolean(user?.isAdmin);
  const repos = await dashboardService.getUserRepositories(user?.accessToken);

  return c.html(<DashboardPage username={username} isAdmin={isAdmin} repos={repos} />);
});

viewRoutes.get("/admin", (c) => {
  const user = getSessionUser(c);
  if (!user?.isAdmin) {
    return c.text("Forbidden: Admin privileges required", 403);
  }
  return c.html(<AdminPage username={user.username} />);
});

async function renderSetupPage(c: any) {
  const user = getSessionUser(c);
  const repos = await dashboardService.getUserRepositories(user?.accessToken);
  return c.html(<SetupPage repos={repos} />);
}

viewRoutes.get("/setup", renderSetupPage);
viewRoutes.get("/install/callback", renderSetupPage);
viewRoutes.get("/github/callback", renderSetupPage);
