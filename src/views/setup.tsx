import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { RepoSettingsDto } from "../domain/models";

export interface SetupPageProps {
  repos: RepoSettingsDto[];
}

export const SetupPage: FC<SetupPageProps> = ({ repos }) => {
  return (
    <Layout title="PikiLand 🏰 앱 설치 완료" bodyClass="landing-body">
      <div class="glow-bg"></div>
      <div
        class="glass-card landing-card"
        style="max-width: 620px; text-align: center; margin: 40px auto; padding: 36px 32px;"
      >
        <div class="castle-icon" style="font-size: 3.5rem; margin-bottom: 12px;">
          🎉
        </div>
        <h1 class="main-title" style="font-size: 2rem; margin-bottom: 8px;">
          PikiLand GitHub App 설치 완료!
        </h1>
        <p
          class="tagline"
          style="margin-bottom: 24px; color: var(--text-dim); font-size: 0.95rem; line-height: 1.5;"
        >
          선택하신 저장소에 PikiLand App 권한이 정상 부여되었습니다.<br />
          이제 대시보드에서 자가 치유 자동화 및 오류 모니터링을 설정할 수 있습니다.
        </p>

        <div
          style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 28px; text-align: left;"
        >
          <h3
            style="margin-top: 0; margin-bottom: 12px; font-size: 1rem; color: #818cf8; display: flex; align-items: center; gap: 8px;"
          >
            <span>📦</span> 연동된 저장소 (<span>{repos.length}</span>개)
          </h3>
          {repos.length === 0 ? (
            <div style="color: #64748b; font-size: 0.9rem; font-style: italic;">
              아직 감지된 저장소가 없거나 GitHub에서 권한 업데이트를 처리 중입니다.
            </div>
          ) : (
            <ul style="list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto;">
              {repos.map((repo) => (
                <li
                  key={repo.fullName}
                  style="padding: 10px 14px; margin-bottom: 8px; background: rgba(255,255,255,0.04); border-radius: 8px; font-family: monospace; font-size: 0.9rem; color: #38bdf8; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(255,255,255,0.05);"
                >
                  <span>{repo.fullName}</span>
                  <span style="font-size: 0.75rem; background: rgba(5, 150, 105, 0.2); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.4); padding: 2px 10px; border-radius: 12px; font-weight: 600;">
                    앱 설치됨
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <a
          href="/dashboard"
          class="btn btn-primary"
          style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 1rem; padding: 14px 28px; text-decoration: none; width: 100%; border-radius: 8px; font-weight: 600;"
        >
          🚀 PikiLand 대시보드 열기
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
