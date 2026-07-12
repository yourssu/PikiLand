package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;

public interface NotifierPort {
    void sendNotification(String webhookUrl, String rawLog, AiAnalysisResult aiResult, String eventType, String repo, String runId, String prUrl);
}
