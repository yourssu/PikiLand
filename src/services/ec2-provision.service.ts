import { Client } from "ssh2";
import { randomUUID } from "crypto";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";

export class Ec2ProvisionService {
  public async provisionInstance(params: {
    repositoryFullName: string;
    ec2Ip: string;
    sshUser: string;
    logPath?: string;
    pemKeyContent: string;
    pipelineServerHost?: string;
    pipelineServerPort?: number;
    bearerToken?: string;
  }): Promise<boolean> {
    const { repositoryFullName, ec2Ip, sshUser, pemKeyContent } = params;
    if (!repositoryFullName || !ec2Ip || !sshUser || !pemKeyContent) {
      throw new Error("Invalid EC2 provisioning arguments.");
    }

    const effectiveLogPath = params.logPath && params.logPath.trim().length > 0 ? params.logPath : "/var/log/production/*.log";
    const effectiveHost = params.pipelineServerHost && params.pipelineServerHost.trim().length > 0 ? params.pipelineServerHost : "localhost";
    const effectivePort = params.pipelineServerPort && params.pipelineServerPort > 0 ? params.pipelineServerPort : 443;
    const token = params.bearerToken && params.bearerToken.trim().length > 0 ? params.bearerToken : randomUUID();

    const [host, portStr] = ec2Ip.includes(":") ? ec2Ip.split(":") : [ec2Ip, "22"];
    const port = parseInt(portStr, 10) || 22;

    const confContent = this.generateFluentBitConf(effectiveLogPath, effectiveHost, effectivePort, token, repositoryFullName);

    const conn = new Client();

    try {
      await this.connectSsh(conn, {
        host,
        port,
        username: sshUser,
        privateKey: pemKeyContent,
        readyTimeout: 20000,
      });

      console.log(`[Ec2Provision] Connected via SSH to ${host}:${port}`);

      // Step 1: Install Fluent Bit if not present
      const installCmd =
        "if ! command -v fluent-bit >/dev/null 2>&1 && ! [ -f /opt/fluent-bit/bin/fluent-bit ]; then " +
        "curl https://raw.githubusercontent.com/fluent/fluent-bit/master/install.sh | sh; fi";

      await this.execCommand(conn, installCmd);

      // Step 2: SFTP write configuration
      const sftp = await this.openSftp(conn);
      await this.writeSftpFile(sftp, "/tmp/fluent-bit.conf", confContent);

      // Step 3: Move configuration and restart service
      const restartCmd =
        "sudo mkdir -p /etc/fluent-bit && " +
        "sudo mv /tmp/fluent-bit.conf /etc/fluent-bit/fluent-bit.conf && " +
        "sudo systemctl restart fluent-bit && " +
        "sudo systemctl enable fluent-bit";

      const restartExitCode = await this.execCommand(conn, restartCmd);

      if (restartExitCode === 0) {
        repoSettingsRepository.updateLogIngestConfig(repositoryFullName, {
          logIngestActive: true,
          logReceiverToken: token,
          ec2Ip,
          logPath: effectiveLogPath,
        });
        console.log(`[Ec2Provision] Successfully provisioned EC2 for repo: ${repositoryFullName}`);
        return true;
      } else {
        console.error(`[Ec2Provision] Service restart exited with code ${restartExitCode}`);
        try {
          await this.execCommand(conn, "rm -f /tmp/fluent-bit.conf");
        } catch {}
        return false;
      }
    } catch (err: any) {
      console.error("[Ec2Provision] Provisioning Error:", err.message);
      try {
        await this.execCommand(conn, "rm -f /tmp/fluent-bit.conf");
      } catch {}
      return false;
    } finally {
      try {
        conn.end();
      } catch {
        // ignore cleanup error
      }
    }
  }

  private connectSsh(conn: Client, config: any): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.once("ready", () => resolve());
      conn.once("error", (err) => reject(err));
      conn.connect(config);
    });
  }

  private execCommand(conn: Client, cmd: string): Promise<number> {
    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        stream.once("close", (code: number) => resolve(code || 0));
        stream.on("error", (streamErr: Error) => reject(streamErr));
      });
    });
  }

  private openSftp(conn: Client): Promise<any> {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);
        resolve(sftp);
      });
    });
  }

  private writeSftpFile(sftp: any, remotePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath);
      stream.once("error", (err: Error) => reject(err));
      stream.once("finish", () => resolve());
      stream.end(content, "utf8");
    });
  }

  public generateFluentBitConf(logPath: string, host: string, port: number, token: string, repoName: string): string {
    const tlsSetting = port === 443 ? "On" : "Off";
    return `[SERVICE]
    Flush           5
    Daemon          Off
    Log_Level       info
    Parsers_File    parsers.conf

[INPUT]
    Name            tail
    Path            ${logPath}
    Tag             myapp.production
    Read_from_Head  Off
    Rotate_Wait     5
    multiline.parser java, python, go, cri, docker

[FILTER]
    Name            grep
    Match           myapp.production
    Regex           log (error|ERROR|Error|exception|Exception|EXCEPTION|fatal|FATAL|critical|CRITICAL|panic|PANIC|unhandled|Unhandled|UNHANDLED|fail|FAIL|severe|SEVERE|5[0-9][0-9]|traceback|Traceback|NullPointer)

[OUTPUT]
    Name            http
    Match           myapp.production
    Host            ${host}
    Port            ${port}
    URI             /api/logs/ingest
    Header          Authorization Bearer ${token}
    Header          X-Pikiland-Repo ${repoName}
    Format          json
    tls             ${tlsSetting}
    tls.verify      Off
    tls.vhost       ${host}
    net.keepalive   On
`;
  }
}

export const ec2ProvisionService = new Ec2ProvisionService();
