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
- AI에게 로그랑 같이 줄 프롬프트 (개선 필요)
- AI가 스스로 코드베이스 탐색
- AI의 응답 포맷 JSON으로 강제
- AI가 판단하여 가능할 시 자동 PR 생성 (생성 조건 개선 필요)
- AI의 판단을 비개발자가 이해하기 쉽게 설명하여 Slack에 제시 (프롬프트 개선 필요)

### 구현해야 할 것
- AI 학습 기능 (메모리)
- AI가 아직 자체 테스트 없이 PR을 올리게 되어 있음
- 슬랙에서 PR 승인 기능 (현재는 깃헙에서 승인 필요)
- Sentry, PostHog 연동해서 런타임 에러 받아오기
- **AI가 올린 PR을 E2E 검증 루프로 확인하기**
    - AI가 여러 PR 후보를 생성하도록 수정
    - E2E 검증 루프 만들기

---

## 1. 아키텍처 및 작동 흐름 (Workflow)

1. **이벤트 감지 및 비동기 스케줄링**:
   - 리포지토리에서 빌드 실패(`workflow_run.completed` - conclusion: failure) 또는 이슈 오픈(`issues.opened`) 웹훅 이벤트가 발생하면 Spring Boot WebhookController가 즉시 수신합니다.
   - 웹 서버의 응답 지연을 방지하기 위해, 웹훅 서명 검증이 통과하면 즉시 200 OK를 반환하고, 실제 AI 분석 비즈니스 로직은 **Java 21 Virtual Threads** 기반으로 백그라운드 스레드에서 완전히 비동기 실행됩니다.
2. **인프라 계층을 통한 데이터 수집 및 정제**:
   - `LogTruncator` 도메인 서비스를 활용해 로그 파일의 Head와 Tail을 분할 추출하고, 키워드 매칭 구간 병합(Interval Merge) 알고리즘을 사용해 에러 지점들의 문맥을 정제합니다.
3. **AI 오류 분석 및 자율 탐색 (Ports & Adapters 루프)**:
   - `OpenAiAdapter`가 AI Gateway에 분석을 요청합니다.
   - AI가 오류의 맥락을 정확히 짚기 위해 제공된 도구(`list_directory`, `read_file_content`, `grep_in_file`)를 호출하면, Application Layer의 포트를 거쳐 `LocalWorkspaceAdapter`가 임시 작업 폴더(`tempfile`)에서 Git 소스 코드를 자율 탐색하여 정보를 반환합니다.
   - 루프 Stuck 방지(동일 도구 5회 이상 호출 시 에러 가드) 및 3회 이중 회복 탄력 루프가 동작합니다.
4. **자동 코드 패치 및 PR 생성**:
   - AI가 오류 수정법을 확신하고 패치 지침을 제공하면, `LocalWorkspaceAdapter`가 소스 코드를 바꾸어 임시 브랜치를 만들고 push합니다.
   - `GithubAppAuthenticator`를 통해 획득한 임시 GitHub Installation Access Token을 사용해 REST API로 자동으로 Pull Request(PR)를 발행합니다.
5. **Slack 알림**:
   - 마크다운 접기 문법(`<details>`)으로 에러 로그를 숨기고 비개발자용 핵심 피드백 요약 및 위험도를 Slack Webhook으로 발송합니다.

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
│   │   │   │   ├── model/           # RepoSettings, PatchInstruction, AiAnalysisResult (JPA-free)
│   │   │   │   ├── port/            # RepoSettingsRepository, WorkspacePort, AiAgentPort, NotifierPort (DIP)
│   │   │   │   └── service/         # LogTruncator (구간 병합 에러로그 정제)
│   │   │   │
│   │   │   └── infrastructure/      # Layer 4: 데이터 액세스 & 인프라 계층
│   │   │       ├── persistence/     # JPA Entity, JpaRepository, RepoSettingsRepositoryImpl (DIP 구현)
│   │   │       ├── workspace/       # LocalWorkspaceAdapter (ProcessBuilder Git 제어)
│   │   │       ├── ai/              # OpenAiAdapter (자율 에이전트 루프 구현)
│   │   │       ├── github/          # GithubAppAuthenticator (JWT 및 GitHub API 연동)
│   │   │       └── slack/           # SlackNotifierAdapter (Webhook 알림 발송)
│   │   │
│   │   └── resources/
│   │       ├── templates/           # Thymeleaf HTML 템플릿 (index.html, dashboard.html)
│   │       ├── static/              # CSS & JS 리소스 (main.css, dashboard.js)
│   │       ├── application.yml      # 공통 및 가상 스레드 설정
│   │       ├── application-local.yml# 개발용 로컬 설정 (H2 DB)
│   │       └── application-prod.yml # 프로덕션 설정 (PostgreSQL DB)
│   │
│   └── test/
│       └── java/com/yourssu/pikiland/
│           ├── ArchitectureTest.java# ArchUnit 기반 4계층 아키텍처 규칙 자동 검증 테스트
│           └── LogTruncatorTest.java# LogTruncator 비즈니스 로직 단위 테스트
```

---

## 3. 환경 설정 및 프로필 (Configuration Profiles)

데이터베이스 및 GitHub 연동 설정은 개발(local)과 배포(prod) 프로필로 분리되어 있습니다.

### 필수 환경 변수
서버 구동 시 다음 환경 변수가 주입되어야 합니다:
- `AI_API_KEY`: API Gateway 사용을 위한 인증 키
- `AI_BASE_URL`: OpenAI 호환 API Gateway Base URL
- `GITHUB_APP_ID`: GitHub App ID
- `GITHUB_PRIVATE_KEY_PATH`: GitHub App Private Key (.pem) 파일 경로
- `GITHUB_CLIENT_ID`: GitHub OAuth Client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth Client Secret
- `GITHUB_WEBHOOK_SECRET`: GitHub Webhook Signature 검증 비밀 키

---

## 4. 로컬 테스트 및 개발 가이드

### 4.1 빌드 및 테스트 실행
자체 구현된 ArchUnit 계층 구조 검사 및 비즈니스 로직 테스트를 수행합니다.
```bash
./gradlew clean test
```

### 4.2 로컬 애플리케이션 실행
로컬 H2 데이터베이스(file-persisted)를 사용하여 서버를 구동합니다.
```bash
./gradlew bootRun --args='--spring.profiles.active=local'
```
구동 완료 후 브라우저에서 `http://localhost:8080`에 접속하여 GitHub OAuth 로그인을 테스트할 수 있습니다.

### 4.3 자가 치유 시뮬레이션 Dry-Run 테스트
실제 외부 API 인증키나 GitHub/Slack 외부 연동 망 없이도, 전체 자가 치유 워크플로우(로그 정제, AI 다단계 자율 코드 탐색, 소스 패치 적용, 가상 PR/알림 연동)가 정상 구동되는지 격리 검증하는 Dry-Run 테스트를 제공합니다.
```bash
./gradlew test --tests "*DryRunTest*"
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
   - 생성한 GitHub App을 타겟 조직(Organization) 또는 저장소에 설치합니다.
