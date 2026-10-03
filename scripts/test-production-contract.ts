/** Local contract test: real coordinator/engine/gates, synthetic logs and mocked AI/GitHub only. */
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { randomUUID } from "crypto";

const engineRoot=process.env.ENGINE_WORKSPACE_PATH;
if(!engineRoot) throw new Error("Set ENGINE_WORKSPACE_PATH to the companion engine checkout");
const fixture=await mkdtemp(join(tmpdir(),"pikiland-contract-"));
process.env.DATABASE_PATH=join(fixture,"coordinator.sqlite");
const {app}=await import("../src/index");
const {repoSettingsRepository}=await import("../src/db/repositories/repo-settings.repository");
const {productionSignalService}=await import("../src/services/production-signal.service");
const {sqlite}=await import("../src/db");
const {SelfHealingService}=await import(pathToFileURL(join(resolve(engineRoot),"src/services/self-healing.service.ts")).href);
const repo="contract/production";
const token="synthetic-collector-token-12345";
const originalFetch=globalThis.fetch;
const workspace=join(fixture,"workspace");
try {
  await mkdir(workspace);
  for(const d of ["src","tests",".pikiland"]) await mkdir(join(workspace,d));
  await writeFile(join(workspace,"AGENTS.md"),"Fixture: preserve tests and fix source only.");
  await writeFile(join(workspace,"src/response.txt"),"empty");
  await writeFile(join(workspace,"tests/reproduce.ts"),`import {readFileSync} from "fs"; if(readFileSync("src/response.txt","utf8")!=="content") {console.log("EXPECTED_RESPONSE_MISSING");process.exit(1);}`);
  await writeFile(join(workspace,"tests/regression.ts"),`import {existsSync} from "fs"; if(!existsSync("src/response.txt")) process.exit(1);`);
  await writeFile(join(workspace,".pikiland/production-verification.json"),JSON.stringify({version:1,service:"nginx",route:"all",ruleIds:["empty_response_shift"],expectedBehavior:"The fixture must return nonempty content",reproductionCommand:"bun run tests/reproduce.ts",regressionCommand:"bun run tests/regression.ts",failureMarker:"EXPECTED_RESPONSE_MISSING",failureExitCode:1,allowedSourcePaths:["src"],protectedPaths:["tests"]}));
  for(const args of [["init"],["config","user.name","Contract Test"],["config","user.email","test@example.invalid"],["add","."],["commit","-m","fixture"]]) {
    const proc=Bun.spawn(["git",...args],{cwd:workspace,stdout:"ignore",stderr:"pipe"});
    if(await proc.exited) throw new Error("Fixture setup failed");
  }
  repoSettingsRepository.save({repositoryFullName:repo,active:true,logIngestActive:true,logReceiverToken:token,harnessStatus:"ACTIVE",harnessSource:"USER_PROVIDED",ralphMaxRetries:1});
  // Generate candidate with the actual Python parser/detector, not a fabricated error tag.
  const generator=`import sys,json,time\nsys.path.insert(0,'observer')\nfrom observer import Detector\nnow=int(time.time());d=Detector({'observerId':'web-1','service':'nginx','routes':[]},now-600)\nresult=[]\nfor n in range(10):\n for i in range(100):d.feed('192.0.2.1 - - [02/Oct/2026:10:00:00 +0900] "GET / HTTP/1.1" 200 '+('0' if n>=8 else '123'))\n result.extend(d.flush(now-540+n*60))\nprint(json.dumps(result[0]))`;
  const generatorProc=Bun.spawn(["python3","-c",generator],{cwd:resolve(import.meta.dir,".."),stdout:"pipe",stderr:"pipe"});
  const signal=JSON.parse(await new Response(generatorProc.stdout).text());
  if(await generatorProc.exited) throw new Error("Observer failed");
  signal.signalId=randomUUID();
  const response=await app.request("/api/production/signals",{method:"POST",headers:{Authorization:`Bearer ${token}`,"X-Pikiland-Repo":repo,"Content-Type":"application/json"},body:JSON.stringify(signal)});
  if(response.status!==202) throw new Error(`Ingest failed: ${await response.text()}`);
  const {incidentId}=await response.json() as {incidentId:string};
  await productionSignalService.drain(async()=>{});
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    if(url.origin==="https://api.github.com") return new Response(JSON.stringify({full_name:repo,permissions:{push:true}}));
    if(url.origin!=="https://coordinator.invalid") throw new Error("Unexpected external request");
    return app.request(url.pathname+url.search,init);
  }) as typeof fetch;
  const engine=new SelfHealingService();
  const result={isConfident:true,summary:"fixture",impact:"fixture",causeDescription:"empty response",prNeeded:true,prTitle:"fix: response",prBody:"Restore response content",prNotNeededReason:null,issueNeeded:null,issueTitle:null,issueBody:null};
  engine.aiAdapter.diagnose=async()=>result;
  engine.aiAdapter.analyzeError=async()=>{await writeFile(join(workspace,"src/response.txt"),"content");return result;};
  engine.githubAdapter.findOpenPullRequest=async()=>null;
  let published=0;
  engine.workspaceAdapter.commitAndPush=async(...args:unknown[])=>{
    if(JSON.stringify(args[7])!==JSON.stringify(["src/response.txt"])) throw new Error("Unverified files would be published");
  };
  engine.githubAdapter.createPullRequest=async()=>{published++;return "https://example.invalid/pr/1";};
  await engine.run({eventType:"production_log",runId:incidentId,repoName:repo,token:"ghs_synthetic_runner",workspacePath:workspace,logContent:"",maxRetries:1,pikilandServerUrl:"https://coordinator.invalid",targetBranch:"main"});
  const job=sqlite.query("SELECT outcome FROM production_jobs WHERE incident_id=?").get(incidentId) as {outcome:string};
  if(job.outcome!=="PR_CREATED" || published!==1) throw new Error("Publication contract failed");
  console.log("PASS: nginx 200 logs -> behavioral signal -> durable job -> authenticated evidence -> real Red/Green + regression -> one mocked PR -> result callback");
} finally {
  globalThis.fetch=originalFetch;
  sqlite.close();
  await rm(fixture,{recursive:true,force:true});
}
