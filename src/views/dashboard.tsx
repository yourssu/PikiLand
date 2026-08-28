import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { RepoSettingsDto } from "../domain/models";

export interface DashboardPageProps {
  username: string;
  isAdmin: boolean;
  repos: RepoSettingsDto[];
}

export const DashboardPage: FC<DashboardPageProps> = ({ username, isAdmin, repos }) => {
  return (
    <Layout title="대시보드 🏰 PikiLand">
      <div class="glow-bg"></div>
      <div class="container">
        <header class="glass-header">
          <div class="logo">🏰 PikiLand</div>
          <div class="user-control">
            <span class="username">{username}</span>
            {isAdmin && (
              <span class="badge badge-active" style="margin-right: 4px;">
                관리자
              </span>
            )}
            <button
              type="button"
              class="theme-toggle-btn"
              onclick="toggleTheme()"
              title="다크/라이트 테마 전환"
            >
              <span id="theme-icon">🌙</span> <span id="theme-text">라이트 모드로 전환</span>
            </button>
            {isAdmin && (
              <a
                href="/admin"
                class="btn btn-secondary"
                style="font-size: 0.85rem; border-color: #f59e0b; color: #fbbf24; text-decoration: none;"
              >
                ⚙️ 어드민 설정
              </a>
            )}
            <a href="/logout" class="btn btn-secondary btn-logout">
              로그아웃
            </a>
          </div>
        </header>

        <main class="dashboard-main">
          {/* Target Repository Setup Guide Card */}
          <div class="glass-card guide-card">
            <h3 style="margin-top: 0; color: var(--primary-solid); font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
              ⚙️ 대상 리포지토리 설정 가이드
            </h3>
            <p style="margin: 6px 0 14px 0; color: var(--text-dim); font-size: 0.92rem; line-height: 1.5;">
              PikiLand가 대상 리포지토리에서 버그를 재현/수정하고 PR을 생성하려면 아래 2가지 설정을 리포지토리에 완료해야 합니다.
            </p>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px;">
              {/* 1. API Keys Guide */}
              <div class="guide-box">
                <strong style="color: var(--primary-solid); font-size: 0.95rem; display: block; margin-bottom: 6px;">
                  🔑 1. AI API 키 (Secrets) 설정
                </strong>
                <p style="margin: 0 0 8px 0; color: var(--text-dim); font-size: 0.85rem; line-height: 1.4;">
                  <strong>Repository Settings → Secrets and variables → Actions</strong> 경로에서 사용할 AI 키를 등록하세요:
                </p>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  <div class="guide-code">
                    <strong style="color: var(--primary-solid);">OPENAI_API_KEY</strong>: OpenAI API 키 (GPT 모델용)
                  </div>
                  <div class="guide-code">
                    <strong style="color: var(--primary-solid);">ANTHROPIC_API_KEY</strong>: Anthropic API 키 (Claude 모델용)
                  </div>
                  <div class="guide-code">
                    <strong style="color: var(--primary-solid);">PIKILAND_AI_API_KEY</strong>: 통합 AI API 키 (선택 사항)
                  </div>
                </div>
              </div>

              {/* 2. Workflow Permissions Guide */}
              <div class="guide-box">
                <strong style="color: #f59e0b; font-size: 0.95rem; display: block; margin-bottom: 6px;">
                  🔒 2. GitHub Actions 쓰기 및 PR 권한 허용
                </strong>
                <p style="margin: 0 0 8px 0; color: var(--text-dim); font-size: 0.85rem; line-height: 1.4;">
                  권한 설정이 비활성화되어 있으면 PR 생성 시 <code>403 Permission Denied</code> 에러가 발생합니다.
                </p>
                <p style="margin: 0 0 6px 0; color: var(--text-light); font-size: 0.85rem; line-height: 1.4;">
                  <strong>Repository Settings → Actions → General → Workflow permissions</strong>:
                </p>
                <ul style="margin: 0 0 0 18px; padding: 0; color: var(--text-dim); font-size: 0.83rem; line-height: 1.5;">
                  <li>🔘 <strong>Read and write permissions</strong> 선택</li>
                  <li>☑️ <strong>Allow GitHub Actions to create and approve pull requests</strong> 체크</li>
                </ul>
              </div>
            </div>
          </div>

          <div class="main-header">
            <h1>연동 저장소 목록</h1>
            <p>저장소별 자가 치유 AI 모델, Ralph 최대 재시도 횟수, Slack 웹훅 및 하네스 명령어를 구성합니다.</p>
          </div>

          {/* Repository Owner Tabs Navigation Bar */}
          <div id="repo-tabs-bar" class="repo-tabs-container"></div>

          <div class="repo-grid">
            {repos.length === 0 ? (
              <div class="glass-card empty-card" data-owner="all" style="width: 100%; text-align: center; padding: 40px 20px;">
                <p style="color: var(--text-dim);">연동된 저장소가 없습니다. GitHub 계정에 저장소 접근 권한이 부여되었는지 확인해 주세요.</p>
              </div>
            ) : (
              repos.map((repo) => {
                const owner = repo.fullName.includes("/") ? repo.fullName.split("/")[0] : "other";
                const isPendingInference =
                  repo.harnessStatus === "PENDING_CONFIRMATION" &&
                  Boolean(repo.inferredHarnessCmd && repo.inferredHarnessCmd.trim().length > 0);

                return (
                  <div key={repo.fullName} class="glass-card repo-card" data-owner={owner}>
                    <div class="repo-meta">
                      <div>
                        <h3 class="repo-title">{repo.fullName}</h3>
                        <div
                          class="status-badges"
                          style="margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;"
                        >
                          <span class={`badge ${repo.hasAppInstalled ? "badge-active" : "badge-none"}`}>
                            {repo.hasAppInstalled ? "✅ 앱 설치됨" : "⚠️ 앱 미설치"}
                          </span>
                          <span
                            class={`badge status-badge-harness ${
                              repo.harnessStatus === "ACTIVE"
                                ? "badge-active"
                                : repo.harnessStatus === "PENDING_CONFIRMATION"
                                ? "badge-pending"
                                : "badge-none"
                            }`}
                            data-repo={repo.fullName}
                          >
                            하네스: {repo.harnessStatus}
                          </span>
                          {repo.harnessSource && repo.harnessSource !== "NONE" && (
                            <span
                              class="badge badge-info status-badge-source"
                              data-repo={repo.fullName}
                            >
                              출처: {repo.harnessSource}
                            </span>
                          )}
                          <span
                            class={`badge badge-ec2 status-badge-ec2`}
                            data-repo={repo.fullName}
                            style={repo.logIngestActive ? "display: inline-flex;" : "display: none;"}
                          >
                            📡 EC2 수집 활성
                          </span>
                          {!repo.hasAppInstalled && (
                            <a
                              href="https://github.com/apps/pikiland/installations/new"
                              target="_blank"
                              rel="noreferrer"
                              class="btn btn-secondary"
                              style="font-size: 0.75rem; padding: 2px 8px; color: #fbbf24; border-color: #f59e0b; text-decoration: none;"
                            >
                              🔑 앱 설치하기
                            </a>
                          )}
                        </div>
                      </div>
                      <label class="switch">
                        <input
                          type="checkbox"
                          id={`toggle-${repo.fullName}`}
                          checked={repo.active}
                          data-installed={String(Boolean(repo.hasAppInstalled))}
                          data-repo={repo.fullName}
                          onchange="handleToggleChange(this)"
                        />
                        <span class="slider"></span>
                      </label>
                    </div>

                    <div class="repo-details">
                      <div class="form-group">
                        <label for={`slack-${repo.fullName}`}>Slack 웹훅 URL</label>
                        <input
                          type="text"
                          id={`slack-${repo.fullName}`}
                          value={repo.slackWebhookUrl || ""}
                          placeholder="https://hooks.slack.com/services/..."
                        />
                      </div>

                      <div class="form-group">
                        <label for={`model-${repo.fullName}`}>커스텀 AI 모델 (선택 사항)</label>
                        <input
                          type="text"
                          id={`model-${repo.fullName}`}
                          value={repo.customModel || ""}
                          placeholder="gpt-4o / claude-3-5-sonnet"
                        />
                      </div>
                      <div class="form-group">
                        <label for={`baseUrl-${repo.fullName}`}>커스텀 Base URL (선택 사항)</label>
                        <input
                          type="text"
                          id={`baseUrl-${repo.fullName}`}
                          value={repo.customBaseUrl || ""}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                      <div class="form-group">
                        <label for={`ralph-${repo.fullName}`}>Ralph 최대 재시도 횟수</label>
                        <input
                          type="number"
                          id={`ralph-${repo.fullName}`}
                          value={String(repo.ralphMaxRetries || 3)}
                          min="1"
                          max="10"
                          placeholder="3"
                        />
                      </div>

                      {/* Inferred Harness Banner */}
                      <div
                        id={`inferred-box-${repo.fullName}`}
                        class="inferred-box"
                        style={
                          isPendingInference
                            ? "background: rgba(255,193,7,0.1); border: 1px solid rgba(255,193,7,0.3); padding: 10px; border-radius: 8px; margin-bottom: 12px; display: block;"
                            : "background: rgba(255,193,7,0.1); border: 1px solid rgba(255,193,7,0.3); padding: 10px; border-radius: 8px; margin-bottom: 12px; display: none;"
                        }
                      >
                        <label style="color: #ffc107; font-weight: 600;">
                          💡 자동 추론된 테스트 명령어 (승인 대기 중):
                        </label>
                        <div
                          id={`inferred-cmd-${repo.fullName}`}
                          style="font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 4px; margin: 6px 0;"
                        >
                          {repo.inferredHarnessCmd || "추론된 명령어 없음"}
                        </div>
                        <button
                          type="button"
                          class="btn btn-secondary btn-approve-harness"
                          style="font-size: 0.85rem; padding: 4px 10px;"
                          data-repo={repo.fullName}
                          onclick="approveHarness(this.getAttribute('data-repo'))"
                        >
                          추론된 명령어 승인
                        </button>
                      </div>

                      {/* Harness Inference Failed Warning Banner */}
                      <div
                        id={`failed-box-${repo.fullName}`}
                        class="failed-box"
                        style={
                          repo.harnessStatus === "FAILED"
                            ? "background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 10px; border-radius: 8px; margin-bottom: 12px; display: block;"
                            : "background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 10px; border-radius: 8px; margin-bottom: 12px; display: none;"
                        }
                      >
                        <div style="color: #ef4444; font-size: 0.85rem; line-height: 1.4;">
                          ⚠️ <strong>테스트 명령어 자동 감지 실패</strong>: 저장소 파일에서 테스트 도구를 인식하지 못했습니다. 아래 입력란에 검증 명령어(예: <code>./gradlew test</code>, <code>bun test</code>, <code>pytest</code>)를 직접 입력해 주세요.
                        </div>
                      </div>

                      <div class="form-group">
                        <label for={`harness-${repo.fullName}`}>하네스 검증 명령어</label>
                        <input
                          type="text"
                          id={`harness-${repo.fullName}`}
                          value={repo.harnessCmd || ""}
                          placeholder="예: ./gradlew test, bun test, npm test, pytest, cargo test"
                        />
                      </div>

                      <div class="button-group" style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button
                          type="button"
                          class="btn btn-primary btn-save"
                          style="flex: 1;"
                          data-repo={repo.fullName}
                          onclick="saveSettings(this.getAttribute('data-repo'))"
                        >
                          설정 저장
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary btn-infer-harness"
                          style="font-size: 0.85rem;"
                          data-repo={repo.fullName}
                          onclick="inferHarness(this.getAttribute('data-repo'))"
                        >
                          명령어 재추론
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary"
                          style="font-size: 0.85rem; border-color: #6366f1; color: #818cf8;"
                          data-repo={repo.fullName}
                          data-ec2-ip={repo.ec2Ip || ""}
                          data-log-path={repo.logPath || ""}
                          onclick="openProvisionModal(this.getAttribute('data-repo'), this)"
                        >
                          ⚡ EC2 연동
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary"
                          style="font-size: 0.85rem; border-color: #10b981; color: #34d399;"
                          data-repo={repo.fullName}
                          onclick="openIncidentModal(this.getAttribute('data-repo'))"
                        >
                          📋 인시던트 내역
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      </div>

      {/* EC2 Provisioning Modal */}
      <div
        id="provision-modal"
        class="modal"
        style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); align-items: center; justify-content: center;"
        onclick="handleModalBackdropClick(event)"
      >
        <div class="modal-card">
          <h3 style="margin-top: 0; color: var(--primary-solid); font-size: 1.2rem;">
            EC2 Fluent Bit 프로비저닝
          </h3>
          <p style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 16px;">
            프로덕션 EC2 서버에 Fluent Bit 수집기를 자동 설치하고 연동합니다. 접속 후 SSH 키는 세션 종료 시 즉시 파기됩니다.
          </p>
          <input type="hidden" id="modal-repo-name" />
          <div class="form-group" style="margin-bottom: 12px;">
            <label style="display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 4px;">
              대상 저장소
            </label>
            <input
              type="text"
              id="modal-repo-display"
              readonly
              style="width: 100%; background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-dim); padding: 8px; border-radius: 6px;"
            />
          </div>
          <div class="form-group" style="margin-bottom: 12px;">
            <label style="display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 4px;">
              EC2 인스턴스 IP
            </label>
            <input
              type="text"
              id="modal-ec2-ip"
              placeholder="예: 54.180.x.x 또는 192.168.1.100"
              style="width: 100%;"
            />
          </div>
          <div class="form-group" style="margin-bottom: 12px;">
            <label style="display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 4px;">
              SSH 사용자명
            </label>
            <input
              type="text"
              id="modal-ssh-user"
              value="ec2-user"
              placeholder="ec2-user / ubuntu"
              style="width: 100%;"
            />
          </div>
          <div class="form-group" style="margin-bottom: 12px;">
            <label style="display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 4px;">
              수집 로그 파일 경로
            </label>
            <input
              type="text"
              id="modal-log-path"
              value="/var/log/production/*.log"
              style="width: 100%;"
            />
          </div>

          <div class="form-group" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 4px;">
              SSH 개인키 파일 (.pem / id_rsa / id_ed25519)
            </label>
            <div style="position: relative;">
              <input
                type="file"
                id="modal-pem-key"
                accept=".pem,.key,*"
                style="display: none;"
                onchange="updateFileLabel(this)"
              />
              <div
                onclick="document.getElementById('modal-pem-key').click()"
                style="width: 100%; background: var(--input-bg); border: 1px dashed var(--border-color); color: var(--text-dim); padding: 16px 12px; border-radius: 6px; cursor: pointer; text-align: center; font-size: 0.85rem; transition: border-color 0.2s;"
                onmouseover="this.style.borderColor='var(--primary-solid)'"
                onmouseout="this.style.borderColor='var(--border-color)'"
              >
                <span id="pem-file-label">📁 클릭하여 SSH 개인키 파일을 선택하세요</span>
              </div>
            </div>
            <p style="margin-top: 6px; font-size: 0.75rem; color: var(--text-dim);">
              키 파일은 프로비저닝 완료 후 메모리 및 원격 인스턴스에서 원천 파기됩니다.
            </p>
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button type="button" class="btn btn-secondary" onclick="closeProvisionModal()">
              취소
            </button>
            <button type="button" class="btn btn-primary btn-submit-provision" onclick="submitEc2Provision()">
              프로비저닝 시작
            </button>
          </div>
        </div>
      </div>

      {/* Incident History Modal */}
      <div
        id="incident-modal"
        class="modal"
        style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); align-items: center; justify-content: center;"
        onclick="handleIncidentModalBackdropClick(event)"
      >
        <div class="modal-card" style="max-width: 680px; max-height: 85vh; display: flex; flex-direction: column;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0; color: #34d399; font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
              <span>📋</span> <span id="incident-modal-repo-title">인시던트 내역</span>
            </h3>
            <button
              type="button"
              class="btn btn-secondary"
              style="padding: 4px 10px; font-size: 0.8rem;"
              onclick="closeIncidentModal()"
            >
              ✕ 닫기
            </button>
          </div>
          <p style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 16px;">
            수집된 프로덕션 에러 로그 및 CI 실패 인시던트의 핑거프린트와 자동 패치 진행 상태를 실시간 확인합니다.
          </p>

          <div
            id="incident-list-container"
            style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; max-height: 50vh;"
          >
            <div style="text-align: center; color: var(--text-dim); padding: 20px;">
              인시던트 내역을 불러오는 중...
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 16px; pt-2;">
            <button type="button" class="btn btn-secondary" onclick="closeIncidentModal()">
              확인
            </button>
          </div>
        </div>
      </div>

      <div id="toast" class="toast">
        설정이 저장되었습니다.
      </div>
      <script src="/js/dashboard.js"></script>
    </Layout>
  );
};
