# PikiLand

PikiLand는 GitHub에서 발생한 오류를 분석하고 패치 PR과 Slack 알림을 만드는 GitHub App입니다.

현재 저장소는 **Java 21·Spring Boot 기반 프로토타입**입니다. GitHub Actions 실패와 새 Issue를 감지하고 OpenAI 호환 API로 분석해 최대 3개의 PR을 생성합니다. 목표 제품은 여기서 더 나아가 런타임·사용자 행동 오류까지 수집하고, 실제 재현과 회귀 검증을 통과한 최선의 패치 하나만 공개합니다.

제품 결정은 [Product Design](docs/DESIGN.md), 목표 구조는 [Architecture & Data Pipeline](docs/ARCHITECTURE_AND_DATA_PIPELINE.md)을 기준으로 합니다.

## 현재 구현

- `workflow_run` 실패 및 새 Issue 웹훅 수신
- GitHub 웹훅 서명 검증과 Installation Access Token 발급
- GitHub OAuth 로그인 및 저장소 설정 대시보드
- 로그 정제와 임시 워크스페이스 코드 탐색
- OpenAI 호환 API를 이용한 원인·패치 분석
- 최대 3개의 후보 브랜치와 PR 생성
- 개발자용 PR 설명과 비개발자용 Slack 요약
- H2 로컬 DB와 PostgreSQL 운영 프로필
- ArchUnit 계층 검사와 로그 단위 테스트

## 현재와 목표의 차이

| 항목 | 현재 프로토타입 | M3 목표 |
| --- | --- | --- |
| 입력 | CI 실패, Issue | CI, 런타임 오류, 행동 규칙 위반 |
| AI 실행 | OpenAI 호환 API 키 | 사용자가 선택한 Claude 또는 Codex Provider |
| 후보 처리 | 최대 3개를 검증 없이 각각 PR로 공개 | 내부 검증 후 최선의 하나만 공개 |
| 검증 | 패치 적용 여부 | Harness 기반 Red → Green·회귀 검증 |
| 장시간 작업 | Spring 비동기 실행 | 재시도·복구 가능한 Queue와 Worker |

## 목표 흐름

```text
오류 감지
  → 코드·로그·행동·릴리스 연결
  → 원인과 패치 후보 생성
  → 후보별 재현·수정·회귀 검증
  → 실패 후보 폐기
  → 최선의 패치 하나만 PR로 공개
  → Slack 요약
  → 사람이 최종 머지
```

MVP는 신뢰할 수 있는 Harness와 Ralph Loop가 이미 준비된 저장소를 대상으로 합니다. 패치 전 오류를 재현하지 못하거나 검증을 통과한 후보가 없으면 PR을 만들지 않습니다.

## 로컬 실행

Java 21이 필요합니다.

```bash
cp .env.example .env
set -a
source .env
set +a
./gradlew bootRun --args='--spring.profiles.active=local'
```

실행 후 `http://localhost:8080`에서 GitHub OAuth 로그인과 저장소 설정 화면을 확인할 수 있습니다.

주요 환경 변수:

| 변수 | 용도 |
| --- | --- |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | 현재 OpenAI 호환 AI Gateway |
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PATH` | GitHub App 인증 |
| `GITHUB_WEBHOOK_SECRET` | 웹훅 서명 검증 |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | 대시보드 GitHub OAuth |
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | 운영 PostgreSQL |
| `DRY_RUN` | 로컬 테스트 우회 설정. 운영에서는 반드시 `false` |

`.env`와 GitHub App private key는 커밋하지 마세요.

## 검증

일반 테스트:

```bash
./gradlew test --tests '*ArchitectureTest' --tests '*LogTruncatorTest'
```

실제 AI Gateway API를 호출하는 Dry Run:

```bash
./gradlew cleanTest test --tests '*DryRunTest*' -i
```

Dry Run은 `AI_BASE_URL`과 `AI_API_KEY`를 이용해 실제 OpenAI 호환 HTTP API를 호출합니다. Claude Code 또는 ChatGPT 구독을 사용하는 흐름이 아닙니다.

## 문서

| 문서 | 답하는 질문 |
| --- | --- |
| [Product Design](docs/DESIGN.md) | 왜 만들고 무엇을 우선하는가? |
| [Architecture & Data Pipeline](docs/ARCHITECTURE_AND_DATA_PIPELINE.md) | 어떤 구조와 검증으로 목표를 달성하는가? |
| [Competitive Research](docs/COMPETITORS.md) | 기존 제품과 무엇이 다른가? |
| [Future Ideas](docs/FUTURE_IDEAS.md) | MVP 이후 무엇을 다시 검토할 것인가? |
