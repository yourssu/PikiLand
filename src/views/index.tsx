import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const IndexPage: FC = () => {
  return (
    <Layout title="PikiLand 🏰 AI 자가 치유 오토파일럿" bodyClass="landing-body">
      <div class="glow-bg"></div>
      <div class="glass-card landing-card">
        <div class="castle-icon">🏰</div>
        <h1 class="main-title">PikiLand</h1>
        <p class="tagline">GitHub 워크플로 실패 및 이슈를 자가 보완하는 AI 오토파일럿</p>

        <div class="features-list">
          <div class="feature-item">
            <span class="feature-bullet">⚡</span>
            <span class="feature-text">TypeScript & Bun 기반 초고속 오류 로그 분석</span>
          </div>
          <div class="feature-item">
            <span class="feature-bullet">🤖</span>
            <span class="feature-text">AI 패치 생성 및 하네스(Harness) 검증 루프</span>
          </div>
          <div class="feature-item">
            <span class="feature-bullet">💬</span>
            <span class="feature-text">팀을 위한 검증된 PR 및 Slack 알림 자동화</span>
          </div>
        </div>

        <a href="/login" class="btn btn-primary btn-login">
          <svg class="github-icon" viewBox="0 0 16 16" version="1.1" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            ></path>
          </svg>
          GitHub 계정으로 시작하기
        </a>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            const savedTheme = localStorage.getItem('pikiland-theme') || 'dark';
            document.documentElement.setAttribute('data-theme', savedTheme);
          `,
        }}
      />
    </Layout>
  );
};
