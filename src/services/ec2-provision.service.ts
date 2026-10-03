import { Client } from "ssh2";
import { createHash, randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";

export function observerArtifacts(params: {repositoryFullName:string;sshUser:string;logPath:string;endpoint:string;token:string}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(params.repositoryFullName) || !/^[a-z_][a-z0-9_-]*$/.test(params.sshUser) || params.sshUser === "root") throw new Error("A non-root observer user is required");
  if (!/^\/var\/log\/[A-Za-z0-9_./-]+$/.test(params.logPath) || params.logPath.includes("..")) throw new Error("Select one existing file under /var/log; globs are not supported");
  const url = new URL(params.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/production/signals") throw new Error("Verified HTTPS endpoint required");
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(params.token)) throw new Error("Invalid observer token");
  const name = `pikiland-observer-${createHash("sha256").update(params.repositoryFullName).digest("hex").slice(0,16)}`;
  const config = JSON.stringify({endpoint:url.toString(),repository:params.repositoryFullName,token:params.token,
    observerId:name,service:"web",logPath:params.logPath,statePath:`/var/lib/${name}/spool.sqlite`,routes:[]},null,2);
  const unit = `[Unit]
Description=PikiLand bounded read-only access log observer
After=network-online.target

[Service]
Type=simple
User=${params.sshUser}
ExecStart=/usr/bin/python3 /opt/${name}/observer.py /opt/${name}/config.json
StateDirectory=${name}
StateDirectoryMode=0700
UMask=0077
Restart=on-failure
RestartSec=30
NoNewPrivileges=true
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=64M
CPUQuota=5%
IOWeight=10
TasksMax=8
Nice=19

[Install]
WantedBy=multi-user.target
`;
  return {name,config,unit};
}

export class Ec2ProvisionService {
  public async provisionInstance(params: {
    repositoryFullName:string;ec2Ip:string;sshUser:string;logPath?:string;pemKeyContent:string;
    pipelineServerHost?:string;pipelineServerPort?:number;bearerToken?:string;hostFingerprint?:string;
  }): Promise<boolean> {
    // Fail before connecting if host identity or read-only requirements are missing.
    if (!params.hostFingerprint || !/^[a-f0-9]{64}$/i.test(params.hostFingerprint)) throw new Error("SSH SHA-256 host fingerprint (hex) is required");
    if (!/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(params.ec2Ip)) throw new Error("Invalid SSH host");
    const token = params.bearerToken || randomUUID();
    const logPath = params.logPath || "/var/log/nginx/access.log";
    const port = params.pipelineServerPort || 443;
    const artifacts = observerArtifacts({repositoryFullName:params.repositoryFullName,sshUser:params.sshUser,logPath,
      endpoint:`https://${params.pipelineServerHost || "localhost"}:${port}/api/production/signals`,token});
    const script = await readFile(new URL("../../observer/observer.py",import.meta.url),"utf8");
    const [host,portText] = params.ec2Ip.split(":");
    const conn = new Client();
    const temp = `/tmp/${artifacts.name}-${randomUUID()}`;
    let staged = false;
    let installed = false;
    try {
      await new Promise<void>((resolve,reject) => {
        conn.once("ready",resolve).once("error",reject).connect({host,port:Number(portText || 22),username:params.sshUser,
          privateKey:params.pemKeyContent,readyTimeout:20000,hostHash:"sha256",hostVerifier:(hash:string)=>hash.toLowerCase()===params.hostFingerprint!.toLowerCase()});
      });
      // No packages, permissions, nginx config, reloads or shared Fluent Bit services are changed.
      await this.exec(conn,`test -x /usr/bin/python3 && test -r '${logPath}' && test -f '${logPath}' && command -v systemctl >/dev/null && /usr/bin/python3 -c 'import sys; assert sys.version_info >= (3,9)'`);
      // Do not overwrite an existing observer installation automatically.
      await this.exec(conn,`test ! -e /opt/${artifacts.name} && test ! -e /etc/systemd/system/${artifacts.name}.service && mkdir -m 700 '${temp}'`);
      staged = true;
      const sftp = await new Promise<any>((resolve,reject)=>conn.sftp((err,s)=>err?reject(err):resolve(s)));
      for (const [file,content] of [["observer.py",script],["config.json",artifacts.config],["observer.service",artifacts.unit]]) {
        await new Promise<void>((resolve,reject)=>{const out=sftp.createWriteStream(`${temp}/${file}`,{mode:0o600});out.on("error",reject).on("finish",resolve);out.end(content);});
      }
      await this.exec(conn,`/usr/bin/python3 -c 'import ast; ast.parse(open("${temp}/observer.py").read())' && systemd-analyze verify '${temp}/observer.service'`);
      await this.exec(conn,`sudo -n mkdir -m 755 /opt/${artifacts.name}`);
      installed = true;
      await this.exec(conn,`sudo -n test -d /opt/${artifacts.name} && sudo -n install -m 644 '${temp}/observer.py' /opt/${artifacts.name}/observer.py && sudo -n install -m 600 -o '${params.sshUser}' '${temp}/config.json' /opt/${artifacts.name}/config.json && sudo -n install -m 644 '${temp}/observer.service' /etc/systemd/system/${artifacts.name}.service && sudo -n systemctl daemon-reload && sudo -n systemctl enable --now ${artifacts.name}.service`);
      await this.exec(conn,`sudo -n systemctl is-active --quiet ${artifacts.name}.service`);
      repoSettingsRepository.updateLogIngestConfig(params.repositoryFullName,{logIngestActive:true,logReceiverToken:token,ec2Ip:params.ec2Ip,logPath});
      return true;
    } catch (error) {
      if (installed) {
        await this.exec(conn,`sudo -n systemctl disable --now ${artifacts.name}.service`).catch(()=>{});
        await this.exec(conn,`sudo -n rm -f /etc/systemd/system/${artifacts.name}.service /opt/${artifacts.name}/observer.py /opt/${artifacts.name}/config.json && sudo -n rmdir /opt/${artifacts.name} && sudo -n systemctl daemon-reload`).catch(()=>{});
      }
      throw error;
    } finally {
      if (staged) await this.exec(conn,`rm -f '${temp}/observer.py' '${temp}/config.json' '${temp}/observer.service' && rmdir '${temp}'`).catch(()=>{});
      conn.end();
    }
  }
  private exec(conn:Client,command:string):Promise<void> {
    return new Promise((resolve,reject)=>conn.exec(command,(err,stream)=>{
      if(err){reject(err);return;}
      stream.on("data",()=>{});stream.stderr.on("data",()=>{});
      stream.once("error",reject).once("close",(code:number|null)=>code===0?resolve():reject(new Error("Observer preflight or installation failed; web-server configuration was not changed")));
    }));
  }
}
export const ec2ProvisionService = new Ec2ProvisionService();
