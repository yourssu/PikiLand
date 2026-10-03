import {describe,expect,it} from "bun:test";
import {observerArtifacts,ec2ProvisionService} from "../src/services/ec2-provision.service";
const config={repositoryFullName:"owner/repo",sshUser:"observer",logPath:"/var/log/nginx/access.log",endpoint:"https://example.com/api/production/signals",token:"test-token-12345678"};
describe("Read-only observer provisioning",()=>{
  it("generates isolated resource-limited units without changing nginx",()=>{
    const a=observerArtifacts(config);
    expect(a.unit).toContain("User=observer");expect(a.unit).toContain("MemoryMax=64M");expect(a.unit).toContain("CPUQuota=5%");
    expect(a.unit).toContain("ProtectSystem=strict");expect(a.unit).not.toContain("nginx -s");
    expect(JSON.parse(a.config).logPath).toBe(config.logPath);
  });
  it("rejects insecure endpoints, root, wildcard paths and configuration injection",()=>{
    for(const change of [{sshUser:"root"},{sshUser:"user\nExecStart=bad"},{endpoint:"http://example.com/api/production/signals"},{logPath:"/var/log/*.log"},{logPath:"/var/log/../../etc/passwd"}]) expect(()=>observerArtifacts({...config,...change})).toThrow();
  });
  it("refuses SSH installation without a verified host identity before connecting",async()=>{
    await expect(ec2ProvisionService.provisionInstance({repositoryFullName:"owner/repo",ec2Ip:"127.0.0.1",sshUser:"observer",pemKeyContent:"fake"})).rejects.toThrow("fingerprint");
  });
});
