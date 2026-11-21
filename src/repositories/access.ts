import {
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from "chanfana";
import type { AppContext } from "../types";

export type GitHubRepository = {
  id: number;
  name: string;
  owner: { login: string };
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    pull?: boolean;
    push?: boolean;
  };
};

export async function githubToken(c: AppContext) {
  const session = await c.env.DB.prepare(
    "SELECT github_access_token FROM sessions WHERE id = ? AND expires_at > datetime('now')",
  )
    .bind(c.get("id"))
    .first<{ github_access_token: string }>();
  if (!session) throw new UnauthorizedException();
  return session.github_access_token;
}

async function github<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "PikiLand-Coordinator",
    },
  });
  if (response.status === 401) throw new UnauthorizedException();
  if (response.status === 403 || response.status === 404)
    throw new ForbiddenException();
  if (!response.ok) throw new InternalServerErrorException();
  return response.json() as Promise<T>;
}

export async function installationRepositories(
  token: string,
  installation: number,
) {
  const result: GitHubRepository[] = [];
  for (let page = 1; ; page++) {
    const data = await github<{ repositories: GitHubRepository[] }>(
      token,
      `/user/installations/${installation}/repositories?per_page=100&page=${page}`,
    );
    result.push(...data.repositories);
    if (data.repositories.length < 100) return result;
  }
}

export async function authorize(
  c: AppContext,
  installation: number,
  repoId: number,
  manage = false,
) {
  const repos = await installationRepositories(
    await githubToken(c),
    installation,
  );
  const repo = repos.find((item) => item.id === repoId);
  if (
    !repo ||
    (manage && !repo.permissions?.admin && !repo.permissions?.maintain)
  ) {
    throw new ForbiddenException();
  }
  return repo;
}

export async function accessibleRepositories(c: AppContext) {
  const token = await githubToken(c);
  const result = new Map<number, Set<number>>();
  for (let page = 1; ; page++) {
    const { installations } = await github<{
      installations: { id: number; suspended_at?: string | null }[];
    }>(token, `/user/installations?per_page=100&page=${page}`);
    for (const installation of installations) {
      if (installation.suspended_at) continue;
      const repos = await installationRepositories(token, installation.id);
      result.set(installation.id, new Set(repos.map((repo) => repo.id)));
    }
    if (installations.length < 100) return result;
  }
}
