package com.yourssu.pikiland.infrastructure.workspace;

import com.yourssu.pikiland.domain.model.HarnessResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class LocalWorkspaceAdapter implements WorkspacePort {

    private static final List<String> RESTRICTED_DIRS = Arrays.asList(".git", ".venv", "node_modules", "build", "dist", "target", "out");
    private static final List<String> RESTRICTED_FILES = Arrays.asList(".env", "secrets.json", "credentials");

    @Override
    public Path cloneRepository(String repoFullName, String token) {
        try {
            Path tempDir = Files.createTempDirectory("pikiland-workspace-");
            String cloneUrl = String.format("https://x-access-token:%s@github.com/%s.git", token, repoFullName);
            
            runCommand(new File("."), "git", "clone", cloneUrl, tempDir.toAbsolutePath().toString());
            return tempDir;
        } catch (Exception e) {
            throw new RuntimeException("Failed to clone repository: " + repoFullName, e);
        }
    }

    @Override
    public String listDirectory(Path workspace, String relativePath) {
        try {
            Path targetDir = workspace.resolve(relativePath).toAbsolutePath().normalize();
            if (!targetDir.startsWith(workspace.toAbsolutePath().normalize())) {
                return "Access Denied: Path is outside the project workspace.";
            }

            File dir = targetDir.toFile();
            if (RESTRICTED_DIRS.contains(dir.getName())) {
                return "Access Denied: Restricted directory.";
            }

            if (!dir.exists() || !dir.isDirectory()) {
                return "Directory not found: " + relativePath;
            }

            File[] items = dir.listFiles();
            if (items == null) return "Directory empty.";

            List<String> subdirs = new ArrayList<>();
            List<String> files = new ArrayList<>();

            Arrays.sort(items);
            for (File item : items) {
                String name = item.getName();
                if (RESTRICTED_DIRS.contains(name) || RESTRICTED_FILES.contains(name)) {
                    continue;
                }
                if (item.isDirectory()) {
                    subdirs.add(name);
                } else {
                    files.add(name);
                }
            }

            StringBuilder sb = new StringBuilder();
            sb.append("[Directory: ").append(relativePath.isEmpty() ? "." : relativePath).append("]\n");
            sb.append("- Subdirectories: ").append(subdirs.isEmpty() ? "(None)" : String.join(", ", subdirs)).append("\n");
            sb.append("- Files: ").append(files.isEmpty() ? "(None)" : String.join(", ", files));
            return sb.toString();
        } catch (Exception e) {
            return "Error reading directory: " + e.getMessage();
        }
    }

    @Override
    public String readFile(Path workspace, String relativePath) {
        try {
            Path targetFile = workspace.resolve(relativePath).toAbsolutePath().normalize();
            if (!targetFile.startsWith(workspace.toAbsolutePath().normalize())) {
                return "Access Denied: Path is outside the project workspace.";
            }

            File file = targetFile.toFile();
            if (RESTRICTED_FILES.contains(file.getName()) || isRestrictedPath(workspace, targetFile)) {
                return "Access Denied: Restricted file path.";
            }

            if (!file.exists() || !file.isFile()) {
                return "File not found: " + relativePath;
            }

            List<String> lines = Files.readAllLines(targetFile);
            int maxLines = 300;
            if (lines.size() > maxLines) {
                String truncated = lines.stream().limit(maxLines).collect(Collectors.joining("\n"));
                return truncated + "\n... [Content Truncated - File has " + lines.size() + " lines total, showing first " + maxLines + "] ...";
            }
            return String.join("\n", lines);
        } catch (Exception e) {
            return "Error reading file: " + e.getMessage();
        }
    }

    @Override
    public String grepInFile(Path workspace, String relativePath, String query) {
        try {
            Path targetFile = workspace.resolve(relativePath).toAbsolutePath().normalize();
            if (!targetFile.startsWith(workspace.toAbsolutePath().normalize())) {
                return "Access Denied: Path is outside the project workspace.";
            }

            File file = targetFile.toFile();
            if (RESTRICTED_FILES.contains(file.getName()) || isRestrictedPath(workspace, targetFile)) {
                return "Access Denied: Restricted file path.";
            }

            if (!file.exists() || !file.isFile()) {
                return "File not found: " + relativePath;
            }

            List<String> lines = Files.readAllLines(targetFile);
            List<String> matches = new ArrayList<>();
            String queryLower = query.toLowerCase();

            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i);
                if (line.toLowerCase().contains(queryLower)) {
                    matches.add("[Line " + (i + 1) + "]: " + line.strip());
                    if (matches.size() >= 50) {
                        matches.add("... [Matches capped at 50 results] ...");
                        break;
                    }
                }
            }

            if (matches.isEmpty()) {
                return "No matches found for '" + query + "' inside " + relativePath + ".";
            }
            return "[Matches in " + relativePath + " for '" + query + "']:\n" + String.join("\n", matches);
        } catch (Exception e) {
            return "Error searching file: " + e.getMessage();
        }
    }

    @Override
    public void applyPatches(Path workspace, List<PatchInstruction> patches) {
        for (PatchInstruction patch : patches) {
            try {
                Path targetFile = workspace.resolve(patch.getFilePath()).toAbsolutePath().normalize();
                if (!targetFile.startsWith(workspace.toAbsolutePath().normalize())) {
                    System.err.println("Access Denied: Patch target outside workspace: " + patch.getFilePath());
                    continue;
                }

                File file = targetFile.toFile();
                if (RESTRICTED_FILES.contains(file.getName()) || isRestrictedPath(workspace, targetFile)) {
                    System.err.println("Access Denied: Restricted patch target: " + patch.getFilePath());
                    continue;
                }

                if (!file.exists()) {
                    System.err.println("File not found for patch: " + patch.getFilePath());
                    continue;
                }

                String content = Files.readString(targetFile, StandardCharsets.UTF_8);
                int matchIndex = content.indexOf(patch.getOldCode());
                if (matchIndex >= 0) {
                    System.out.println("Applying patch to: " + patch.getFilePath());
                    // Replace only the FIRST occurrence to avoid clobbering duplicate code blocks
                    String newContent = content.substring(0, matchIndex)
                            + patch.getNewCode()
                            + content.substring(matchIndex + patch.getOldCode().length());
                    Files.writeString(targetFile, newContent, StandardCharsets.UTF_8);
                } else {
                    System.err.println("Warning: Target old_code not found in: " + patch.getFilePath());
                }
            } catch (Exception e) {
                System.err.println("Failed to apply patch for: " + patch.getFilePath() + ", error: " + e.getMessage());
            }
        }
    }

    @Override
    public void commitAndPush(Path workspace, String branchName, String commitMsg, String token, String repo) {
        try {
            File dir = workspace.toFile();
            runCommand(dir, "git", "config", "user.name", "github-actions[bot]");
            runCommand(dir, "git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
            runCommand(dir, "git", "checkout", "-b", branchName);
            runCommand(dir, "git", "add", ".");
            runCommand(dir, "git", "commit", "-m", commitMsg);
            
            String remoteUrl = String.format("https://x-access-token:%s@github.com/%s.git", token, repo);
            runCommand(dir, "git", "remote", "set-url", "origin", remoteUrl);
            runCommand(dir, "git", "push", "origin", branchName);
            System.out.println("Successfully pushed branch: " + branchName);
        } catch (Exception e) {
            throw new RuntimeException("Git commit & push operations failed", e);
        }
    }

    @Override
    public void resetToCleanState(Path workspace, String baseBranch) {
        try {
            File dir = workspace.toFile();
            runCommand(dir, "git", "checkout", "-f", baseBranch);
            runCommand(dir, "git", "reset", "--hard", "HEAD");
            runCommand(dir, "git", "clean", "-fd");
        } catch (Exception e) {
            throw new RuntimeException("Failed to reset workspace to clean state for branch " + baseBranch, e);
        }
    }

    @Override
    public String getCurrentBranch(Path workspace) {
        try {
            File dir = workspace.toFile();
            ProcessBuilder pb = new ProcessBuilder("git", "symbolic-ref", "--short", "HEAD");
            pb.directory(dir);
            Process p = pb.start();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String branch = r.readLine();
                if (branch != null && !branch.isBlank()) {
                    return branch.trim();
                }
            }
            // Fallback for detached HEAD
            ProcessBuilder pb2 = new ProcessBuilder("git", "rev-parse", "--abbrev-ref", "HEAD");
            pb2.directory(dir);
            Process p2 = pb2.start();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p2.getInputStream()))) {
                String branch = r.readLine();
                if (branch != null && !branch.isBlank()) {
                    return branch.trim();
                }
            }
            return "main";
        } catch (Exception e) {
            System.err.println("Failed to detect current branch in git, defaulting to 'main': " + e.getMessage());
            return "main";
        }
    }

    @Override
    public void deleteWorkspace(Path workspace) {
        if (workspace == null) return;
        Path target = workspace.toAbsolutePath().normalize();
        System.out.println("[Workspace] Deleting temp workspace: " + target);
        try {
            Files.walk(target)
                 .sorted(Comparator.reverseOrder()) // children before parents
                 .forEach(p -> {
                     try {
                         Files.deleteIfExists(p);
                     } catch (Exception ex) {
                         // best-effort: log but don't abort the rest of the cleanup
                         System.err.println("[Workspace] Could not delete " + p + ": " + ex.getMessage());
                     }
                 });
            System.out.println("[Workspace] Cleanup complete: " + target);
        } catch (Exception e) {
            System.err.println("[Workspace] Failed to walk workspace for deletion " + target + ": " + e.getMessage());
        }
    }

    @Override
    public int countSourceFiles(Path workspace) {
        if (workspace == null) return 50;
        Path normalizedWorkspace = workspace.toAbsolutePath().normalize();
        try {
            return (int) Files.walk(normalizedWorkspace)
                    .filter(Files::isRegularFile)
                    .filter(p -> {
                        Path relative = normalizedWorkspace.relativize(p.toAbsolutePath().normalize());
                        // Exclude any file whose path contains a restricted directory segment
                        for (Path component : relative) {
                            if (RESTRICTED_DIRS.contains(component.toString())) {
                                return false;
                            }
                        }
                        return true;
                    })
                    .count();
        } catch (Exception e) {
            System.err.println("[Workspace] Failed to count source files: " + e.getMessage());
            return 50; // conservative default keeps the loop budget reasonable
        }
    }


    private boolean isRestrictedPath(Path workspace, Path target) {
        Path relative = workspace.toAbsolutePath().normalize().relativize(target.toAbsolutePath().normalize());
        for (Path element : relative) {
            if (RESTRICTED_DIRS.contains(element.toString())) {
                return true;
            }
        }
        return false;
    }

    private void runCommand(File directory, String... command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(directory);
        Process p = pb.start();
        int exitCode = p.waitFor();
        if (exitCode != 0) {
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getErrorStream()));
            String err = r.lines().collect(Collectors.joining("\n"));
            throw new RuntimeException("Command failed: " + redactSecrets(String.join(" ", command))
                    + " with exit code " + exitCode + ". Error: " + redactSecrets(err));
        }
    }

    // The GitHub installation token is embedded in git remote URLs; strip it from any text
    // that may be thrown, logged, or forwarded so the credential never leaks into logs/Slack/PRs.
    private static String redactSecrets(String text) {
        if (text == null) return null;
        return text.replaceAll("x-access-token:[^@\\s]+@", "x-access-token:***@");
    }

    @Override
    public HarnessResult runHarness(Path workspace, String command) {
        try {
            File dir = workspace.toFile();
            ProcessBuilder pb = new ProcessBuilder("sh", "-c", command);
            pb.directory(dir);
            pb.redirectErrorStream(true);
            Process p = pb.start();

            // Capture output logs
            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    System.out.println("[Harness] " + line);
                    output.append(line).append("\n");
                }
            }
            int exitCode = p.waitFor();
            System.out.println("[Harness] Command '" + command + "' exited with code: " + exitCode);
            return new HarnessResult(exitCode == 0, output.toString());
        } catch (Exception e) {
            String errMsg = "Failed to execute command '" + command + "': " + e.getMessage();
            System.err.println("[Harness] " + errMsg);
            return new HarnessResult(false, errMsg);
        }
    }
}
