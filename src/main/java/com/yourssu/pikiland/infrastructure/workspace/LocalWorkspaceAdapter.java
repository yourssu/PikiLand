package com.yourssu.pikiland.infrastructure.workspace;

import com.yourssu.pikiland.domain.model.PatchInstruction;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
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

                String content = Files.readString(targetFile);
                if (content.contains(patch.getOldCode())) {
                    System.out.println("Applying patch to: " + patch.getFilePath());
                    String newContent = content.replace(patch.getOldCode(), patch.getNewCode());
                    Files.writeString(targetFile, newContent);
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
            throw new RuntimeException("Command failed: " + String.join(" ", command) + " with exit code " + exitCode + ". Error: " + err);
        }
    }
}
