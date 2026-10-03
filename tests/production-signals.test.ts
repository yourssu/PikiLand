import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "crypto";
import { app } from "../src/index";
import { sqlite } from "../src/db";
import { repoSettingsRepository } from "../src/db/repositories/repo-settings.repository";
import { productionSignalService } from "../src/services/production-signal.service";
import { incidentAuthorized } from "../src/services/incident-auth.service";
import { ProductionSignalSchema } from "../src/domain/production-signal";
const repo="test/production";
const token="production-test-token-12345";
function signal(){const now=Math.floor(Date.now()/1000);return {schemaVersion:1,signalId:randomUUID(),observerId:"web-1",service:"nginx",environment:"production",ruleId:"empty_response_shift",ruleVersion:1,route:"all",windowStart:now-60,windowEnd:now,sampleCount:100,violationCount:80,observedRate:0.8,baselineRate:0.01,evidence:[{status:200,bytes:0}],quality:{complete:true,parsed:100,rejected:0}};}
beforeEach(()=>{
  sqlite.exec("DELETE FROM production_signals; DELETE FROM production_jobs;");
  sqlite.query("DELETE FROM log_fingerprints WHERE repository_full_name LIKE 'test/%'").run();
  repoSettingsRepository.save({repositoryFullName:repo,active:true,logIngestActive:true,logReceiverToken:token,harnessStatus:"ACTIVE",harnessSource:"USER_PROVIDED",harnessCmd:"bun test",ralphMaxRetries:1});
});
describe("Production signals",()=>{
  it("accepts 200-only behavioral evidence, stores immutable evidence and dispatches once",async()=>{
    const body=signal();
    const request=()=>app.request("/api/production/signals",{method:"POST",headers:{Authorization:`Bearer ${token}`,"X-Pikiland-Repo":repo,"Content-Type":"application/json"},body:JSON.stringify(body)});
    expect((await request()).status).toBe(202);expect((await request()).status).toBe(202);
    const job=sqlite.query("SELECT * FROM production_jobs").get() as any;
    expect(job.state).toBe("QUEUED");
    let calls=0;
    await Promise.all([productionSignalService.drain(async()=>{calls++;}),productionSignalService.drain(async()=>{calls++;})]);
    expect(calls).toBe(1);
    expect((sqlite.query("SELECT occurrence_count FROM log_fingerprints WHERE hash=?").get(job.incident_id) as any).occurrence_count).toBe(1);
    expect(productionSignalService.finish(repo,job.incident_id,"NEEDS_EVIDENCE")).toBe(true);
    expect(productionSignalService.finish("test/other",job.incident_id,"PR_CREATED")).toBe(false);
  });
  it("does not trigger on incomplete observations and isolates repository identities",()=>{
    const a=ProductionSignalSchema.parse(signal());a.quality.complete=false;
    const id=productionSignalService.accept(repo,a);
    const other=productionSignalService.accept("test/other",a);
    expect(id).not.toBe(other);expect(sqlite.query("SELECT * FROM production_jobs").all()).toHaveLength(0);
  });
  it("records uncertain dispatch without blind retries",async()=>{
    productionSignalService.accept(repo,ProductionSignalSchema.parse(signal()));
    await productionSignalService.drain(async()=>{throw new Error("timeout");});
    let count=0;await productionSignalService.drain(async()=>{count++;});
    expect(count).toBe(0);expect((sqlite.query("SELECT state FROM production_jobs").get() as any).state).toBe("DISPATCH_UNKNOWN");
  });
  it("rejects raw data fields, inconsistent counts and untrusted requests",async()=>{
    expect(ProductionSignalSchema.safeParse({...signal(),requestBody:"secret"}).success).toBe(false);
    expect(ProductionSignalSchema.safeParse({...signal(),violationCount:101}).success).toBe(false);
    expect((await app.request("/api/production/signals",{method:"POST",body:JSON.stringify(signal())})).status).toBe(401);
  });
  it("authenticates GitHub permission and repository rather than token prefix",async()=>{
    const mock=spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({full_name:repo,permissions:{push:true}})));
    try {
      expect(await incidentAuthorized(repo,"ghs_fake")).toBe(true);
      mock.mockResolvedValue(new Response(JSON.stringify({full_name:"test/other",permissions:{push:true}})));
      expect(await incidentAuthorized(repo,"ghs_fake")).toBe(false);
      mock.mockResolvedValue(new Response("",{status:401}));
      expect(await incidentAuthorized(repo,"ghs_fake")).toBe(false);
    } finally {mock.mockRestore();}
  });
});

describe("Observation quality and authorization",()=>{
  it("upgrades incomplete evidence before any job is scheduled",()=>{
    const body=ProductionSignalSchema.parse(signal());body.quality.complete=false;
    const id=productionSignalService.accept(repo,body);
    body.signalId=randomUUID();body.quality.complete=true;
    expect(productionSignalService.accept(repo,body)).toBe(id);
    expect((sqlite.query("SELECT state FROM production_jobs WHERE incident_id=?").get(id) as any).state).toBe("QUEUED");
  });
  it("rejects stale and oversized candidate payloads",async()=>{
    const body=signal();body.windowStart-=90000;body.windowEnd-=90000;
    const send=(data:string)=>app.request("/api/production/signals",{method:"POST",headers:{Authorization:`Bearer ${token}`,"X-Pikiland-Repo":repo,"Content-Type":"application/json"},body:data});
    expect((await send(JSON.stringify(body))).status).toBe(400);
    expect((await send("x".repeat(40000))).status).toBe(413);
  });
  it("records unsupported formats as health without creating an incident",async()=>{
    const response=await app.request("/api/production/health",{method:"POST",headers:{Authorization:`Bearer ${token}`,"X-Pikiland-Repo":repo,"Content-Type":"application/json"},body:JSON.stringify({observerId:"web-1",parsed:0,rejected:50,complete:false,pending:0,dropped:0,capabilities:[]})});
    expect(response.status).toBe(202);
    const status=await app.request(`/api/production/health?repo=${repo}`,{headers:{Authorization:`Bearer ${token}`}});
    expect((await status.json() as any[])[0].complete).toBe(false);
    expect(sqlite.query("SELECT * FROM production_jobs").all()).toHaveLength(0);
  });
  it("does not give collector tokens authority to report engine outcomes",async()=>{
    const id=productionSignalService.accept(repo,ProductionSignalSchema.parse(signal()));
    const response=await app.request(`/api/production/incidents/${id}/result`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({outcome:"PR_CREATED"})});
    expect(response.status).toBe(401);
  });
  it("requires login before accepting an SSH provisioning request",async()=>{
    process.env.PIKILAND_DEBUG="false";process.env.DEBUG="false";process.env.PIKILAND_UI_PREVIEW="false";
    expect((await app.request("/api/settings/provision-ec2",{method:"POST"})).status).toBe(403);
  });
});
