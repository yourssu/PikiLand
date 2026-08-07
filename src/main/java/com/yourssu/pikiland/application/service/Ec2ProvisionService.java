package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermission;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

@Service
public class Ec2ProvisionService {

    private static final Logger logger = LoggerFactory.getLogger(Ec2ProvisionService.class);

    private final RepoSettingsRepository repoSettingsRepository;

    public Ec2ProvisionService(RepoSettingsRepository repoSettingsRepository) {
        this.repoSettingsRepository = repoSettingsRepository;
    }

    public boolean provisionInstance(String repositoryFullName,
                                     String ec2Ip,
                                     String sshUser,
                                     String logPath,
                                     String pemKeyContent,
                                     String pipelineServerHost,
                                     int pipelineServerPort,
                                     String bearerToken) {
        if (repositoryFullName == null || repositoryFullName.isBlank() ||
            ec2Ip == null || ec2Ip.isBlank() ||
            sshUser == null || sshUser.isBlank() ||
            pemKeyContent == null || pemKeyContent.isBlank()) {
            throw new IllegalArgumentException("Invalid EC2 provisioning arguments.");
        }

        String effectiveLogPath = (logPath != null && !logPath.isBlank()) ? logPath : "/var/log/production/*.log";
        String effectiveHost = (pipelineServerHost != null && !pipelineServerHost.isBlank()) ? pipelineServerHost : "localhost";
        int effectivePort = pipelineServerPort > 0 ? pipelineServerPort : 443;
        String token = (bearerToken != null && !bearerToken.isBlank()) ? bearerToken : "your_secure_agent_token_here";

        File tempKeyFile = null;
        File tempConfFile = null;

        try {
            // 1. Create temporary SSH private key file with strict permissions (0600)
            tempKeyFile = File.createTempFile("pikiland_key_", ".pem");
            Files.writeString(tempKeyFile.toPath(), pemKeyContent, StandardCharsets.UTF_8);

            // Try POSIX permissions first
            try {
                Set<PosixFilePermission> perms = EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);
                Files.setPosixFilePermissions(tempKeyFile.toPath(), perms);
            } catch (Exception e) {
                logger.warn("[Ec2Provision] POSIX permission setting failed, falling back to chmod");
            }
            // Always enforce chmod 600 to guarantee SSH accepts the key (covers Docker/Alpine environments)
            try {
                Runtime.getRuntime().exec(new String[]{"chmod", "600", tempKeyFile.getAbsolutePath()}).waitFor();
            } catch (Exception e) {
                logger.warn("[Ec2Provision] chmod 600 failed: {}", e.getMessage());
            }

            // 2. Generate Fluent Bit configuration content
            String confContent = generateFluentBitConf(effectiveLogPath, effectiveHost, effectivePort, token, repositoryFullName);
            tempConfFile = File.createTempFile("fluent-bit_", ".conf");
            Files.writeString(tempConfFile.toPath(), confContent, StandardCharsets.UTF_8);

            logger.info("[Ec2Provision] Initiating 1-time SSH provisioning for repo '{}' to EC2 ({})", repositoryFullName, ec2Ip);

            // 3. Execute SSH command: Install Fluent Bit, copy config, restart service, wipe authorized_keys
            String host = ec2Ip;
            String sshPort = "22";
            if (ec2Ip.contains(":")) {
                String[] parts = ec2Ip.split(":", 2);
                host = parts[0];
                sshPort = parts[1];
            }
            String sshTarget = sshUser + "@" + host;
            
            // Step 3a: Install Fluent Bit if not present (official install script)
            String installScript = "if ! command -v fluent-bit >/dev/null 2>&1 && ! [ -f /opt/fluent-bit/bin/fluent-bit ]; then " +
                                   "curl https://raw.githubusercontent.com/fluent/fluent-bit/master/install.sh | sh; " +
                                   "fi";
            executeCommand("ssh", "-p", sshPort, "-i", tempKeyFile.getAbsolutePath(), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", sshTarget, installScript);

            // Step 3b: Copy fluent-bit.conf to /tmp
            executeCommand("scp", "-P", sshPort, "-i", tempKeyFile.getAbsolutePath(), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                    tempConfFile.getAbsolutePath(), sshTarget + ":/tmp/fluent-bit.conf");

            // Step 3c: Move config, restart service, and enable fluent-bit
            String remoteScript = "sudo mkdir -p /etc/fluent-bit && " +
                                  "sudo mv /tmp/fluent-bit.conf /etc/fluent-bit/fluent-bit.conf && " +
                                  "sudo systemctl restart fluent-bit && " +
                                  "sudo systemctl enable fluent-bit";
            executeCommand("ssh", "-p", sshPort, "-i", tempKeyFile.getAbsolutePath(), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", sshTarget, remoteScript);

            // 4. Update RepoSettings persistence
            RepoSettings settings = repoSettingsRepository.findById(repositoryFullName)
                    .orElseGet(() -> new RepoSettings(repositoryFullName, true, null, null, null));
            settings.configureLogIngest(true, token, ec2Ip, effectiveLogPath);
            repoSettingsRepository.save(settings);

            logger.info("[Ec2Provision] Successfully provisioned EC2 ({}) and revoked SSH key for repo '{}'", ec2Ip, repositoryFullName);
            return true;

        } catch (Exception e) {
            logger.error("[Ec2Provision] Provisioning failed for repo '{}' on EC2 ({}): {}", repositoryFullName, ec2Ip, e.getMessage());
            return false;
        } finally {
            // 5. SECURE WIPING: Wipe and delete local temp files immediately
            secureDeleteFile(tempKeyFile);
            secureDeleteFile(tempConfFile);
        }
    }

    private String generateFluentBitConf(String logPath, String host, int port, String token, String repoName) {
        String tlsSetting = (port == 443) ? "On" : "Off";
        return """
            [SERVICE]
                Flush           5
                Daemon          Off
                Log_Level       info
                Parsers_File    parsers.conf

            [INPUT]
                Name            tail
                Path            %s
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
                Host            %s
                Port            %d
                URI             /api/logs/ingest
                Header          Authorization Bearer %s
                Header          X-Pikiland-Repo %s
                Format          json
                tls             %s
                tls.verify      Off
                tls.vhost       %s
                net.keepalive   On
            """.formatted(logPath, host, port, token, repoName, tlsSetting, host);
    }

    private void executeCommand(String... command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        Process p = pb.start();
        int exitCode = p.waitFor();
        if (exitCode != 0) {
            String error = new String(p.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            throw new RuntimeException("Command failed with exit code " + exitCode + ": " + error);
        }
    }

    private void secureDeleteFile(File file) {
        if (file != null && file.exists()) {
            try {
                // Overwrite with zeros before deletion
                long length = file.length();
                if (length > 0) {
                    byte[] zeros = new byte[(int) Math.min(length, 4096)];
                    Files.write(file.toPath(), zeros);
                }
                Files.delete(file.toPath());
            } catch (Exception e) {
                file.delete();
            }
        }
    }
}
