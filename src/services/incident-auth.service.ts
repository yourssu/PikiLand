import { timingSafeEqual } from "crypto";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";
export function collectorAuthorized(repo: string, token: string): boolean {
  const s = repoSettingsRepository.findById(repo);
  const expected = s?.logReceiverToken;
  return Boolean(s?.active && s.logIngestActive && expected && token && Buffer.byteLength(token) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(token),Buffer.from(expected)));
}
export async function incidentAuthorized(repo: string, token: string): Promise<boolean> {
  if (collectorAuthorized(repo,token)) return true;
  return githubAuthorized(repo,token);
}
export async function githubAuthorized(repo: string, token: string): Promise<boolean> {
  if (!/^(ghs_|ghp_|github_pat_)/.test(token)) return false;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token || token.length > 512) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: {Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json"}, redirect:"error", signal:AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = await res.json() as {full_name?:string;permissions?:{push?:boolean;admin?:boolean}};
    return data.full_name?.toLowerCase() === repo.toLowerCase() && Boolean(data.permissions?.push || data.permissions?.admin);
  } catch { return false; }
}
