package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import java.nio.file.Path;

public interface AiAgentPort {
    AiAnalysisResult analyzeError(String logContent, String eventType, Path workspace, WorkspacePort workspacePort, String customModel);
}
