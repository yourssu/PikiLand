import { sqlite } from "../db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ProductionSignalSchema } from "../domain/production-signal";
import { collectorAuthorized, incidentAuthorized, githubAuthorized } from "../services/incident-auth.service";
import { productionSignalService } from "../services/production-signal.service";
import { logFingerprintRepository } from "../db/repositories/log-fingerprint.repository";
export const productionRoutes = new Hono();
productionRoutes.use("*", bodyLimit({maxSize:32768}));
productionRoutes.post("/signals", async c => {
  const repo = c.req.header("X-Pikiland-Repo") || "";
  const token = c.req.header("Authorization")?.replace(/^Bearer /,"") || "";
  if (!collectorAuthorized(repo,token)) return c.json({error:"Unauthorized"},401);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({error:"Invalid JSON"},400); }
  const parsed = ProductionSignalSchema.safeParse(body);
  if (!parsed.success) return c.json({error:"Invalid production signal"},400);
  const now = Date.now()/1000;
  if (parsed.data.windowEnd > now+60 || parsed.data.windowEnd < now-86400) return c.json({error:"Stale or future observation"},400);
  try { return c.json({incidentId:productionSignalService.accept(repo,parsed.data)},202); }
  catch { return c.json({error:"Incident capacity or storage unavailable"},503); }
});
productionRoutes.post("/incidents/:id/result", async c => {
  const fp = logFingerprintRepository.findByHash(c.req.param("id"));
  const token = c.req.header("Authorization")?.replace(/^Bearer /,"") || "";
  if (!fp || !await githubAuthorized(fp.repositoryFullName,token)) return c.json({error:"Unauthorized"},401);
  const schema = z.object({outcome:z.enum(["PR_CREATED","NO_PR","NEEDS_EVIDENCE","FAILED"])}).strict();
  const body = await c.req.json().catch(()=>null);
  const result = schema.safeParse(body);
  if (!result.success) return c.json({error:"Invalid outcome"},400);
  productionSignalService.finish(fp.repositoryFullName,fp.hash,result.data.outcome);
  return c.json({status:"accepted"});
});

sqlite.exec(`CREATE TABLE IF NOT EXISTS production_observers (
  repo TEXT NOT NULL, observer_id TEXT NOT NULL, last_seen INTEGER NOT NULL, health TEXT NOT NULL,
  PRIMARY KEY(repo, observer_id));`);
const healthSchema=z.object({observerId:z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/),
  parsed:z.number().int().nonnegative(),rejected:z.number().int().nonnegative(),complete:z.boolean(),
  pending:z.number().int().min(0).max(256),dropped:z.number().int().nonnegative(),
  capabilities:z.array(z.enum(["status","bytes","duration"])).max(3)}).strict();
productionRoutes.post("/health",async c=>{
  const repo=c.req.header("X-Pikiland-Repo") || "";
  const token=c.req.header("Authorization")?.replace(/^Bearer /,"") || "";
  if(!collectorAuthorized(repo,token)) return c.json({error:"Unauthorized"},401);
  const parsed=healthSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:"Invalid health report"},400);
  sqlite.query("INSERT INTO production_observers VALUES (?,?,?,?) ON CONFLICT(repo,observer_id) DO UPDATE SET last_seen=excluded.last_seen,health=excluded.health")
    .run(repo,parsed.data.observerId,Date.now(),JSON.stringify(parsed.data));
  return c.json({status:"accepted"},202);
});
productionRoutes.get("/health",async c=>{
  const repo=c.req.query("repo") || "";
  const token=c.req.header("Authorization")?.replace(/^Bearer /,"") || "";
  if(!await incidentAuthorized(repo,token)) return c.json({error:"Unauthorized"},401);
  const rows=sqlite.query("SELECT observer_id,last_seen,health FROM production_observers WHERE repo=?").all(repo) as {observer_id:string;last_seen:number;health:string}[];
  return c.json(rows.map(r=>({observerId:r.observer_id,lastSeen:r.last_seen,stale:Date.now()-r.last_seen>180000,...JSON.parse(r.health)})));
});
