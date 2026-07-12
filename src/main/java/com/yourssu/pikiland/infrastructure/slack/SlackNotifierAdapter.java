package com.yourssu.pikiland.infrastructure.slack;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.port.NotifierPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

@Component
public class SlackNotifierAdapter implements NotifierPort {

    private final RestTemplate restTemplate;

    public SlackNotifierAdapter() {
        this.restTemplate = new RestTemplate();
    }

    @Override
    public void sendNotification(String webhookUrl, String rawLog, AiAnalysisResult aiResult, String eventType, String repo, String runId, String prUrl) {
        boolean isInvalidWebhook = webhookUrl == null || webhookUrl.isBlank() || 
                                   webhookUrl.contains("your/webhook/url") || 
                                   !webhookUrl.startsWith("https://");

        String slackMessage = buildSlackMessage(rawLog, aiResult, eventType, repo, runId, prUrl);

        if (isInvalidWebhook) {
            System.out.println("Warning: SLACK_WEBHOOK_URL is not set or is a placeholder. Printing payload to stdout.");
            System.out.println(slackMessage);
            return;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, String> payload = new HashMap<>();
            payload.put("text", slackMessage);

            HttpEntity<Map<String, String>> entity = new HttpEntity<>(payload, headers);
            restTemplate.postForEntity(webhookUrl, entity, String.class);
            System.out.println("Slack notification sent successfully.");
        } catch (Exception e) {
            System.err.println("Failed to send Slack notification: " + e.getMessage());
        }
    }

    private String buildSlackMessage(String rawLog, AiAnalysisResult aiResult, String eventType, String repo, String runId, String prUrl) {
        String title = "🚨 *[" + repo + "] AI Error Notification*";
        String context;
        if ("issues".equals(eventType)) {
            context = "• *Event*: Issue Opened";
        } else {
            context = "• *Event*: Workflow Run Failed\n• *Run ID*: <https://github.com/" + repo + "/actions/runs/" + runId + "|" + runId + ">";
        }

        String summary = aiResult.getSummary() != null ? aiResult.getSummary() : "핵심 요약 정보가 존재하지 않습니다.";
        String impact = aiResult.getImpact() != null ? aiResult.getImpact() : "영향 범위 정보가 존재하지 않습니다.";
        String cause = aiResult.getCauseDescription() != null ? aiResult.getCauseDescription() : "상세 원인 설명이 존재하지 않습니다.";

        String foldedLog = "<details>\n<summary>📝 원본 에러 로그 보기</summary>\n\n```\n" + rawLog + "\n```\n</details>";
        
        String prStatus;
        if (prUrl != null) {
            String patchSummary = aiResult.getPatchSummary() != null ? aiResult.getPatchSummary() : "코드 수정을 완료했습니다.";
            prStatus = "🤖 *[AI Auto-Patch]* 원인을 감지하여 자동으로 코드를 수정하고 PR을 생성했습니다!\n" +
                       "🛠️ *패치 내용*: " + patchSummary + "\n" +
                       "👉 *PR Link*: <" + prUrl + "|" + prUrl + ">";
        } else {
            prStatus = "ℹ️ *[AI Auto-Patch]* 원인이 불명확하거나 코드로 해결할 수 없어 자동 PR을 생성하지 않았습니다.";
        }

        return title + "\n\n" +
               context + "\n\n" +
               "*📌 핵심 요약*\n" + summary + "\n\n" +
               "*⚠️ 위험도 및 서비스 영향*\n" + impact + "\n\n" +
               "*🔍 상세 원인 및 조치 방법*\n" + cause + "\n\n" +
               foldedLog + "\n\n" +
               prStatus;
    }
}
