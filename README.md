# 피키랜드 (PikiLand) 🏰

**피키랜드(PikiLand)**는 **Java 21 & Spring Boot 3.x** 기반의 독립된 **GitHub App** 서비스 서버로 동작하며, GitHub Actions 환경에서 발생한 빌드 오류나 저장소에 오픈된 이슈를 자동으로 감지하여, AI(OpenAI 규격 API Gateway) 분석을 통해 해결 방안을 도출하고 Slack 알림 및 자동 코드 수정(PR 제출)까지 처리하는 **AI 기반 에러 모니터링 및 자가 치유(Self-Healing) 자동화 시스템**입니다.

### 구현된 것
- 워크플로우 실패 감지
- 이슈 열림 감지
- 에러 로그 또는 이슈 내용 불러오기
- 불러온 내용 AI한테 먹이기 쉽게 전처리 (추가 개선 필요)
    - 이스케이프 코드 제거
    - 로딩 바 등 TUI 제거
    - 긴 로그는 error, failed 등 키워드 감지해서 필터링
- AI에게 로그랑 같이 줄 프롬프트
- AI가 스스로 코드베이스 탐색
- AI의 응답 포맷 JSON으로 강제
- AI가 스스로 버그픽스 PR 최대 3개 생성, PR 설명은 개발자용으로 생성
- AI의 판단을 비개발자가 이해하기 쉽게 설명하여 Slack에 제시

### 구현해야 할 것
- AI 학습 기능 (메모리)
- AI가 아직 자체 테스트 없이 PR을 올리게 되어 있음
- 슬랙에서 PR 승인 기능 (현재는 깃헙에서 승인 필요)
- Sentry, PostHog 연동해서 런타임 에러 받아오기
- **AI가 올린 PR을 E2E 검증 루프로 확인하기**
    - AI가 여러 PR 후보를 생성하도록 수정
    - E2E 검증 루프 만들기
- **전체적인 AI 프롬프트 개선 필요**

---

## 1. 아키텍처 및 작동 흐름 (Workflow)

1. **이벤트 감지 및 비동기 스케줄링**:
   - 저장소의 빌드 실패 또는 이슈 오픈 이벤트를 Spring Boot WebhookController가 수신하면 서명을 검증한 후 즉시 200 OK를 반환합니다.
   - 실제 자가 치유(Self-Healing) 메커니즘은 **Java 21 Virtual Threads**를 이용해 백그라운드 스레드에서 완전히 비동기 실행됩니다.
2. **에러 컨텍스트 수집 및 정제**:
   - `LogTruncator` 도메인 서비스가 로그를 정제하여 불필요한 노이즈를 쳐내고, 핵심 에러 로그만을 남겨 AI 프롬프트에 제공합니다.
3. **AI 오류 분석 및 자율 탐색 (Ports & Adapters)**:
   - `OpenAiAdapter`가 AI Gateway에 분석을 요청합니다.
   - AI가 오류의 맥락을 파악하고자 도구(`list_directory`, `read_file_content`, `grep_in_file`)를 사용하면, Application Layer의 포트를 통해 `LocalWorkspaceAdapter`가 임시 작업 폴더에서 소스 코드를 자율 탐색하여 반환합니다.
4. **다중 브랜치 생성 및 자동 코드 패치**:
   - 제안된 각 PR 후보(최대 3개)에 대해 독립적인 임시 브랜치를 만들고 push합니다.
   - 브랜치 생성 전후로 임시 워크스페이스를 깨끗하게 리셋(`resetToCleanState`)하여 각 PR이 독립적인 수정사항을 가질 수 있도록 보장합니다.
5. **PR 생성 및 Slack 맞춤형 알림**:
   - GitHub App Installation Access Token을 이용해 각 후보 브랜치마다 개별 PR을 발행하며, 설명 하단에 접이식 에러 로그를 삽입합니다.
   - 최종적으로 생성된 PR 주소 리스트를 담아, 비개발자용 한국어 Slack 알림 템플릿으로 요약본을 전송합니다.

---

## 2. 파일 구조 (Project Structure)

Strict 4-Layered Architecture (Presentation -> Application -> Domain <- Infrastructure)를 완벽하게 준수하며, 테스트 빌드 시 ArchUnit으로 계층 침범 및 역참조를 강제 검증합니다.

```text
pikiland/
├── build.gradle.kts                # Gradle 빌드 및 의존성 명세
├── settings.gradle.kts             # Gradle 프로젝트 설정
├── src/
│   ├── main/
│   │   ├── java/com/yourssu/pikiland/
│   │   │   ├── PikilandApplication.java # Spring Boot 메인 클래스
│   │   │   │
│   │   │   ├── presentation/        # Layer 1: 표현 계층 (UI, REST, Controller)
│   │   │   │   ├── controller/      # WebhookController, DashboardController, SecurityConfig
│   │   │   │   └── dto/             # Response DTO
│   │   │   │
│   │   │   ├── application/         # Layer 2: 애플리케이션 계층 (Usecase)
│   │   │   │   ├── service/         # WebhookAppService, SelfHealingAppService
│   │   │   │   └── dto/             # RepoSettingsDto (레이어 간 데이터 교환 모델)
│   │   │   │
│   │   │   ├── domain/              # Layer 3: 도메인 계층 (순수 핵심 코어)
│   │   │   │   ├── model/           # RepoSettings, PatchInstruction, AiAnalysisResult, PrCandidate (JPA-free)
│   │   │   │   ├── port/            # RepoSettingsRepository, WorkspacePort, AiAgentPort, NotifierPort, GithubAuthPort (DIP)
│   │   │   │   └── service/         # LogTruncator (구간 병합 에러로그 정제)
│   │   │   │
│   │   │   └── infrastructure/      # Layer 4: 데이터 액세스 & 인프라 계층
│   │   │       ├── persistence/     # JPA Entity, JpaRepository, RepoSettingsRepositoryImpl (DIP 구현)
│   │   │       ├── workspace/       # LocalWorkspaceAdapter (ProcessBuilder Git 제어)
│   │   │       ├── ai/              # OpenAiAdapter (자율 에이전트 루프 및 다중 PR 추출)
│   │   │       ├── github/          # GithubAppAuthenticator (JWT 및 GitHub API 연동)
│   │   │       └── slack/           # SlackNotifierAdapter (Webhook 맞춤형 알림 발송)
│   │   │
│   │   └── resources/
│   │       ├── templates/           # Thymeleaf HTML 템플릿 (index.html, dashboard.html)
│   │       ├── static/              # CSS & JS 리소스
│   │       │   ├── css/main.css
│   │       │   └── js/dashboard.js
│   │       ├── application.yml      # 공통 및 가상 스레드 설정
│   │       ├── application-local.yml# 개발용 로컬 설정 (H2 DB)
│   │       └── application-prod.yml # 프로덕션 설정 (PostgreSQL DB)
│   │
│   └── test/
│       └── java/com/yourssu/pikiland/
│           ├── ArchitectureTest.java# ArchUnit 기반 4계층 아키텍처 규칙 자동 검증 테스트
│           ├── LogTruncatorTest.java# LogTruncator 비즈니스 로직 단위 테스트
│           └── DryRunTest.java      # .env 로드를 통한 실전형 AI 자가 치유 시뮬레이션 통합 테스트
```

---

## 3. 환경 설정 및 프로필 (Configuration Profiles)

데이터베이스 및 GitHub 연동 설정은 개발(local)과 배포(prod) 프로필로 분리되어 있습니다.

### 환경 변수 (`.env`)
로컬 서버 구동 시 또는 Dry-Run 테스트 실행 시 다음 환경 변수가 필요합니다:
- `AI_API_KEY`: API Gateway 사용을 위한 인증 키
- `AI_BASE_URL`: OpenAI 호환 API Gateway Base URL
- `AI_MODEL`: 분석에 사용할 기본 AI 모델명 (예: `gpt-4o`, `gpt-5.4-mini` 등)
- `DRY_RUN`: AI 드라이런(dry-run) 바이패스 활성화 여부 (로컬 테스트 시 서명/소유권 검증 생략)
- `GITHUB_APP_ID`: GitHub App ID
- `GITHUB_PRIVATE_KEY_PATH`: GitHub App Private Key (.pem) 파일 경로
- `GITHUB_CLIENT_ID`: GitHub OAuth Client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth Client Secret
- `GITHUB_WEBHOOK_SECRET`: GitHub Webhook Signature 검증 비밀 키

Production 시 다음 환경 변수가 추가로 필요합니다:
- `DATABASE_URL`: 프로덕션 데이터베이스 접속 URL (예: `jdbc:postgresql://localhost:5432/pikilanddb`)
- `DATABASE_USER`: 프로덕션 데이터베이스 사용자명
- `DATABASE_PASSWORD`: 프로덕션 데이터베이스 비밀번호

---

## 4. 로컬 테스트 및 개발 가이드

### 4.1 빌드 및 전체 테스트 실행
계층 구조 검사, 단위 테스트 및 통합 테스트를 수행합니다.
```bash
./gradlew clean test -i
```

### 4.2 로컬 애플리케이션 실행
로컬 H2 데이터베이스(file-persisted)를 사용하여 서버를 구동합니다.
```bash
# .env 환경 변수를 로드한 상태로 구동 (Zsh / Bash)
set -a && source .env && set +a && ./gradlew bootRun --args='--spring.profiles.active=local'
```
구동 완료 후 브라우저에서 `http://localhost:8080`에 접속하여 GitHub OAuth 로그인을 테스트할 수 있습니다.

### 4.3 자가 치유 시뮬레이션 Dry-Run 테스트 (실시간 AI 검증)
실제 외부 GitHub/Slack 망에 이벤트를 전송하지 않되, 로컬 `.env`에 명시된 실제 AI 게이트웨이 및 모델을 호출해 소스 코드의 분석, 수정, 다중 PR 생성 분기 흐름을 검증합니다.
```bash
./gradlew cleanTest test --tests "*DryRunTest*" -i
```

---

## 5. 서비스 등록 및 GitHub App 설정 가이드

피키랜드를 실제 저장소에 도입하기 위해서는 GitHub App 등록이 필요합니다:
1. **GitHub App 등록**:
   - GitHub Developer settings에서 New GitHub App을 생성합니다.
   - **Homepage URL** 및 **Callback URL**(`http://<your-domain>/login/oauth2/code/github`)을 입력합니다.
   - **Webhook URL**에 `http://<your-domain>/webhook`을 입력하고 Webhook Secret을 설정합니다.
2. **권한(Permissions) 설정**:
   - `Repository permissions` -> `Contents: Read & Write` (자동 코드 패치 push용)
   - `Repository permissions` -> `Pull Requests: Read & Write` (자동 PR 발행용)
   - `Repository permissions` -> `Actions: Read` (빌드 로그 다운로드용)
3. **이벤트(Events) 구독**:
   - `Workflow run` (완료 시점의 빌드 실패 감지)
   - `Issues` (이슈 오픈 감지)
4. **App 설치**:
   - 생성한 GitHub App을 타겟 저장소에 설치합니다.
