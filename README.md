# PikiLand 🏰

> **AI-Powered Self-Healing Autopilot for your GitHub Workflows & Issues**

PikiLand는 GitHub CI/CD 워크플로 실패 및 이슈를 수신하고, AI 코드 분석과 하네스(Harness) 기반 자가 보완 루프(Ralph Loop)를 거쳐 **실제 검증된 단 하나의 패치 PR**과 Slack 알림을 자동 생성하는 시스템입니다.

---

## 🌟 주요 특징

- **오케스트레이터 & 실행 엔진 이원화**:
  - **Web App (Coordinator)**: Spring Boot 3.3 (Java 21, Virtual Threads) 기반의 오케스트레이터. 웹훅 수신, OAuth 인증, 대시보드, 어드민 및 저장소 워크플로 자동 삽입을 관리합니다.
  - **CLI (Execution Engine)**: GitHub Actions 환경에서 단발성으로 동작하는 실행 엔진 (`yourssu/PikiLand-Engine`). 분석, Ralph Loop, 패치 적용, PR 생성을 담당합니다.
- **Harness & Ralph Loop 기반 자가 보완 검증**:
  - 패치 전 테스트 실패(Red)로 버그를 재현하고, 패치 후 테스트 성공(Green) 및 회귀 테스트를 통과한 패치만 PR로 생성합니다.
- **Harness Command 자동 추론**:
  - 저장소 연동 시 Gradle, Maven, npm, pytest 등 프로젝트 빌드/테스트 도구를 자동 추론하여 추천합니다.
- **독립된 어드민 페이지 & 보안 액세스 제어**:
  - 중앙 시스템 설정(GitHub App ID, Private Key, OAuth Credentials)을 별도의 `/admin` 페이지로 분리하고 `PIKILAND_ADMIN_USERS` 기반 접근 권한을 적용했습니다.
- **소유자(Owner)별 저장소 분류 & 다크/라이트 테마**:
  - 대시보드 내 저장소들을 소유자별 탭으로 깔끔하게 필터링할 수 있으며, 다크/라이트 테마 전환 스위치를 제공합니다.

---

## 🏗️ 전체 아키텍처

```text
[ GitHub Webhook / Issues ]
           │
           ▼
┌─────────────────────────────────────────┐
│ PikiLand Web App (Coordinator)          │
│ - 웹훅 수신 & OAuth2 인증                │
│ - pikiland.yml 워크플로 자동 삽입       │
│ - 대시보드 & 어드민 UI (/admin)         │
└────────────────────┬────────────────────┘
                     │ workflow_dispatch
                     ▼
┌─────────────────────────────────────────┐
│ Target Repo: .github/workflows/pikiland │
│ └─ PikiLand Engine (CLI)                │
│    - Harness 기반 버그 재현 (Red)        │
│    - AI 기반 원인 분석 & 패치 생성      │
│    - Ralph Loop 자가 보완 검증 (Green)   │
│    - Verified PR 생성 & Slack 알림      │
└─────────────────────────────────────────┘
```

---

## 🚦 두 가지 실행 모드

### 1. Web App 모드 (Coordinator) — 본 저장소 (`yourssu/PikiLand`)
- **역할**: 사용자 대시보드, GitHub OAuth 로그인, 웹훅 수신, 시스템 설정 및 워크플로 자동 삽입.
- **실행 환경**: 지속 구동되는 웹 서버 (`Spring Boot 3.3`, 포트 `8080`).

### 2. CLI 모드 (Execution Engine) — 전용 저장소 (`yourssu/PikiLand-Engine`)
- **역할**: 격리된 GitHub Actions Runner 상에서 가동되는 단발성 패치/검증 엔진.
- **실행 환경**: 대상 저장소의 GitHub Actions Runner (Native Java 21 Batch 실행).

---

## 💻 로컬 개발 환경 실행

Java 21 환경이 필요합니다.

```bash
# 1. 환경 변수 설정 (.env 작성)
cp .env.example .env

# 2. 로컬 서버 실행
./gradlew bootRun --args='--spring.profiles.active=local'
```

서버 실행 후 브라우저에서 `http://localhost:8080`으로 접속할 수 있습니다.

### 주요 환경 변수 (Web Coordinator 서버)

| 환경 변수 | 설명 |
|-----------|------|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | 대시보드 로그인용 GitHub OAuth 인증 정보 |
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PATH` | GitHub App 인증 정보 |
| `GITHUB_WEBHOOK_SECRET` | GitHub Webhook HMAC 서명 검증 키 |
| `PIKILAND_ADMIN_USERS` | 어드민 페이지(`/admin`)에 접근할 수 있는 GitHub 사용자명 (쉼표 구분) |
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | PostgreSQL 접속 정보 |
| `DEBUG` (또는 `PIKILAND_DEBUG`) | 디버그 모드 여부 (`true` 시 서명 및 어드민 권한 검사 우회, 기본값: `false`) |

---

## 🧪 테스트 실행

ArchUnit 계층 구조 검사 및 로그 정제 단위 테스트를 포함한 전체 테스트 스위트를 실행합니다.

```bash
./gradlew clean test
```

---

## 📚 상세 관련 문서

프로젝트의 세부 설계, 아키텍처, 배포 가이드는 `docs/` 디렉터리의 문서를 참고하세요.

| 문서 | 설명 |
|------|------|
| [📖 Product Design](docs/DESIGN.md) | 제품 범위, 핵심 철학 및 MVP 결정 사항 |
| [🏗️ Architecture & Data Pipeline](docs/ARCHITECTURE_AND_DATA_PIPELINE.md) | 전체 데이터 파이프라인, Harness 및 Ralph Loop 상세 계약 |
| [🚀 Deployment Guide](docs/DEPLOYMENT.md) | Nginx 설정, GitHub App 등록, Docker 배포 및 대상 저장소 설정 가이드 |
| [🔍 Competitive Research](docs/COMPETITORS.md) | 타 솔루션 및 기존 코딩 에이전트와의 차별점 분석 |
| [💡 Future Ideas](docs/FUTURE_IDEAS.md) | MVP 이후 고려할 확장 아이디어 보관소 |
