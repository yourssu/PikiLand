package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.PatchInstruction;
import java.nio.file.Path;
import java.util.List;

public interface WorkspacePort {
    Path cloneRepository(String repoFullName, String token);
    String listDirectory(Path workspace, String relativePath);
    String readFile(Path workspace, String relativePath);
    String grepInFile(Path workspace, String relativePath, String query);
    void applyPatches(Path workspace, List<PatchInstruction> patches);
    void commitAndPush(Path workspace, String branchName, String commitMsg, String token, String repo);
}
