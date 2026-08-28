import { describe, expect, it } from "bun:test";
import { ec2ProvisionService } from "../src/services/ec2-provision.service";

describe("Ec2ProvisionService", () => {
  it("should generate valid Fluent Bit configuration with error regex grep filter", () => {
    const conf = ec2ProvisionService.generateFluentBitConf(
      "/var/log/myapp/*.log",
      "pikiland.yourssu.com",
      443,
      "test-agent-token",
      "yourssu/pikiland"
    );

    expect(conf).toContain("Name            tail");
    expect(conf).toContain("Path            /var/log/myapp/*.log");
    expect(conf).toContain("Name            grep");
    expect(conf).toContain("Regex           log (error|ERROR|Error|exception|Exception|EXCEPTION|fatal|FATAL|critical|CRITICAL|panic|PANIC|unhandled|Unhandled|UNHANDLED|fail|FAIL|severe|SEVERE|5[0-9][0-9]|traceback|Traceback|NullPointer)");
    expect(conf).toContain("Name            http");
    expect(conf).toContain("Host            pikiland.yourssu.com");
    expect(conf).toContain("Port            443");
    expect(conf).toContain("URI             /api/logs/ingest");
    expect(conf).toContain("Header          Authorization Bearer test-agent-token");
    expect(conf).toContain("Header          X-Pikiland-Repo yourssu/pikiland");
    expect(conf).toContain("tls             On");
  });

  it("should disable TLS when running on non-443 port", () => {
    const conf = ec2ProvisionService.generateFluentBitConf(
      "/var/log/app.log",
      "127.0.0.1",
      8080,
      "token123",
      "owner/repo"
    );

    expect(conf).toContain("tls             Off");
    expect(conf).toContain("Port            8080");
  });
});
