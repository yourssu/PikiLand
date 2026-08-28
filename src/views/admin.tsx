import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export interface AdminPageProps {
  username: string;
}

export const AdminPage: FC<AdminPageProps> = ({ username }) => {
  return (
    <Layout title="어드민 시스템 설정 🛡️ PikiLand">
      <div class="glow-bg"></div>
      <div class="container">
        <header class="glass-header">
          <div class="logo">🏰 PikiLand Admin</div>
          <div class="user-control">
            <span class="username">{username}</span>
            <span class="badge badge-active" style="margin-right: 4px;">
              관리자
            </span>
            <button
              type="button"
              class="theme-toggle-btn"
              onclick="toggleTheme()"
              title="다크/라이트 테마 전환"
            >
              <span id="theme-icon">🌙</span> <span id="theme-text">라이트 모드로 전환</span>
            </button>
            <a href="/dashboard" class="btn btn-secondary" style="font-size: 0.85rem; text-decoration: none;">
              ← 대시보드로 돌아가기
            </a>
            <a href="/logout" class="btn btn-secondary btn-logout">
              로그아웃
            </a>
          </div>
        </header>

        <main class="dashboard-main">
          <div class="main-header" style="margin-bottom: 24px;">
            <h1 style="color: #fbbf24; display: flex; align-items: center; gap: 10px;">
              🛡️ 중앙 시스템 설정
            </h1>
            <p>PikiLand App 인증 정보, OAuth 자격 증명 및 서버 전용 개인키를 관리합니다.</p>
          </div>

          {/* Global System Settings Panel (Admin Only Page) */}
          <div
            class="glass-card admin-card"
            style="border-left: 4px solid #f59e0b; background: rgba(245, 158, 11, 0.05); padding: 24px; border-radius: 12px;"
          >
            <div
              style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;"
            >
              <div>
                <h2 style="margin: 0; color: #fbbf24; font-size: 1.25rem;">
                  ⚙️ GitHub App 및 OAuth 인증 정보
                </h2>
                <p style="margin: 4px 0 0 0; font-size: 0.88rem; color: #94a3b8;">
                  웹훅 검증 및 GitHub API 요청 시 Coordinator 서버가 사용하는 중앙 인증 정보입니다.
                </p>
              </div>
              <button
                type="button"
                class="btn btn-primary btn-save-system"
                onclick="saveSystemSettings()"
                style="padding: 10px 20px; font-weight: 600;"
              >
                💾 시스템 설정 저장
              </button>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
              <div class="form-group">
                <label for="sys-githubAppId" style="font-weight: 600;">
                  GitHub App ID
                </label>
                <input type="text" id="sys-githubAppId" placeholder="예: 1029384" />
              </div>
              <div class="form-group">
                <label for="sys-githubWebhookSecret" style="font-weight: 600;">
                  웹훅 Secret (Webhook Secret)
                </label>
                <input type="password" id="sys-githubWebhookSecret" placeholder="••••••••" />
              </div>
              <div class="form-group">
                <label for="sys-githubClientId" style="font-weight: 600;">
                  OAuth Client ID
                </label>
                <input type="text" id="sys-githubClientId" placeholder="예: Ov23zXXXXXXXXXXXXXXX" />
              </div>
              <div class="form-group">
                <label for="sys-githubClientSecret" style="font-weight: 600;">
                  OAuth Client Secret
                </label>
                <input type="password" id="sys-githubClientSecret" placeholder="••••••••" />
              </div>
              <div class="form-group" style="grid-column: 1 / -1;">
                <label for="sys-pikilandServerUrl" style="font-weight: 600;">
                  🌐 PikiLand Web Server URL (HTTPS 공인 도메인 주소)
                </label>
                <input
                  type="text"
                  id="sys-pikilandServerUrl"
                  placeholder="예: https://pikiland.yourdomain.com"
                />
                <small style="color: #94a3b8; font-size: 0.8rem; margin-top: 4px; display: block;">
                  GitHub Actions Runner가 에러 로그를 역조회할 때 접속할 서버의 공개 URL입니다.
                </small>
              </div>
              <div class="form-group" style="grid-column: 1 / -1;">
                <label
                  for="sys-githubPrivateKeyFile"
                  style="font-weight: 600; display: block; margin-bottom: 6px;"
                >
                  📂 GitHub App 개인키 파일 (.pem 파일 업로드)
                </label>
                <input
                  type="file"
                  id="sys-githubPrivateKeyFile"
                  accept=".pem,.key"
                  onchange="handlePemFileUpload(event)"
                  style="padding: 12px; border: 1px dashed var(--border-color); border-radius: 8px; background: var(--input-bg); cursor: pointer; width: 100%; color: var(--text-light);"
                />
                <input type="hidden" id="sys-githubPrivateKeyContent" />
                <div
                  id="pem-file-status"
                  style="font-size: 0.88rem; color: #10b981; margin-top: 8px; display: none;"
                >
                  ✅ 개인키 (.pem) 파일이 정상적으로 로드되었습니다.
                </div>
              </div>
            </div>
          </div>

          {/* Server-Side AI Provider Settings Panel (Admin Only) */}
          <div
            class="glass-card admin-card"
            style="border-left: 4px solid #6366f1; background: rgba(99, 102, 241, 0.05); padding: 24px; border-radius: 12px; margin-top: 24px;"
          >
            <div style="margin-bottom: 20px;">
              <h2 style="margin: 0; color: var(--primary-solid); font-size: 1.25rem;">
                🤖 중앙 AI Provider 설정 (서버 전용)
              </h2>
              <p style="margin: 4px 0 0 0; font-size: 0.88rem; color: var(--text-dim);">
                Coordinator 서버 측의 로그 및 하네스 분석에 사용됩니다.<br />
                <span style="color: var(--primary-solid);">
                  참고: 실제 실행 엔진(CLI) 패치 생성용 AI 모델과 시크릿은 저장소별 Secrets로 격리됩니다.
                </span>
              </p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
              <div class="form-group">
                <label for="sys-globalAiBaseUrl" style="font-weight: 600;">
                  글로벌 AI Base URL
                </label>
                <input type="text" id="sys-globalAiBaseUrl" placeholder="https://api.openai.com/v1" />
              </div>
              <div class="form-group">
                <label for="sys-globalAiApiKey" style="font-weight: 600;">
                  글로벌 AI API Key
                </label>
                <input type="password" id="sys-globalAiApiKey" placeholder="sk-proj-••••••••" />
              </div>
              <div class="form-group">
                <label for="sys-globalAiModel" style="font-weight: 600;">
                  글로벌 AI 모델명
                </label>
                <input type="text" id="sys-globalAiModel" placeholder="gpt-4o" />
              </div>
            </div>
          </div>
        </main>
      </div>

      <div id="toast" class="toast">
        설정이 저장되었습니다.
      </div>
      <script src="/js/dashboard.js"></script>
    </Layout>
  );
};
