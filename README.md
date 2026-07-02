# 피키랜드 (PikiLand) 🏰

**피키랜드(PikiLand)**는 GitHub Actions 환경에서 발생한 오류나 오픈된 이슈를 자동으로 감지하여, AI(OpenAI 규격 API) 분석을 통해 오류의 핵심 원인과 해결 방안을 도출한 뒤 Slack으로 알림을 전송하는 **AI 기반 에러 모니터링 및 알림 자동화 시스템**입니다.

---

## 1. 아키텍처 및 작동 흐름 (Workflow)

1. **이벤트 감지 (GitHub Actions Trigger)**:
   - 빌드/배포 워크플로우가 **실패**하거나 저장소에 **이슈(Issue)**가 생성되면 모니터링 워크플로우가 자동으로 실행됩니다.
2. **데이터 수집 및 전처리**:
   - 실패한 워크플로우의 실행 ID(`RUN_ID`)를 기반으로 GitHub API에서 에러 로그를 다운로드하여 텍스트를 파싱 및 병합합니다.
   - AI 컨텍스트 한계를 고려해 로그의 Head와 Tail을 분할 추출하고, 에러 키워드를 정밀 탐색하여 노이즈를 필터링하는 **전처리(Truncate) 작업**을 수행합니다.
3. **AI 오류 분석**:
   - 가공된 텍스트를 설정된 API Gateway(예: OpenAI 규격)를 통해 분석 요청합니다.
   - 시니어 DevOps 엔지니어의 관점에서 **오류 위치**, **발생 원인**, **영향 범위**, **해결 방안**을 요약한 마크다운 피드백을 수신합니다.
4. **Slack 알림 발송**:
   - 원본 에러 로그는 가독성을 위해 **마크다운 접기 문법(`<details>`)**으로 감싸 숨기고, AI 피드백은 **접지 않고 바로 노출**하여 Slack Incoming Webhook을 통해 실시간 전송합니다.

---

## 2. 파일 구조 (Project Structure)

```text
pikiland/
├── .github/
│   ├── workflows/
│   │   └── ai-error-monitor.yml   # GitHub Actions 트리거 및 실행 단계 정의
│   └── scripts/
│       ├── analyze_error.py       # 메인 제어 엔트리포인트 스크립트
│       ├── config.py              # 로컬 및 시스템 환경 변수 로더
│       ├── log_utils.py           # 로그 다운로드, ANSI 정제, Truncate 유틸리티
│       ├── ai_client.py           # OpenAI 규격 API Gateway AI 분석기
│       ├── git_utils.py           # 로컬 소스 패치 및 GitHub PR 생성 도구
│       └── slack_notifier.py      # Slack 마크다운 템플릿 빌더 및 알림 전송기
├── .env.example                   # 로컬 디버깅 및 테스트를 위한 환경 변수 템플릿
├── .gitignore                     # 로컬 가상 환경 및 비밀 정보 파일(.env) 업로드 방지
└── README.md                      # 본 설명 문서
```

---

## 3. 환경 변수 적용 우선순위 (Secrets & Variables)

보안과 테스트의 편의성을 극대화하기 위해 환경 변수는 다음의 우선순위로 매핑되어 적용됩니다.

| 우선순위 | 제공처 (환경) | 설명 |
| :---: | :--- | :--- |
| **1순위 (우선)** | **GitHub Secrets / OS Environment** | **프로덕션 환경** (GitHub Actions 실행 시 자동 주입). 지정된 환경 변수가 최우선 적용됩니다. |
| **2순위 (폴백)** | **로컬 `.env` 파일** | **디버그/로컬 환경** (Secrets가 주입되지 않은 상황). 1순위 변수가 비어 있을 경우에만 로컬 `.env` 파일을 파싱하여 환경 변수를 동적으로 로드합니다. |

### 지원 환경 변수 목록

| 로컬 `.env` 키 | 프로덕션 환경 변수 명 | 설명 | 기본값 |
| :--- | :--- | :--- | :--- |
| `base_url` | `AI_BASE_URL` | OpenAI 호환 API Gateway Base URL | `https://example.ai/v1/gateway` |
| `api_key` | `AI_API_KEY` | AI API 사용 인증 키 | (필수 지정 필요) |
| `slack_webhook_url` | `SLACK_WEBHOOK_URL` | Slack 알림 Incoming Webhook URL | (미지정 시 stdout으로 대체 출력) |
| `ai_model` | `AI_MODEL` | 분석에 사용할 모델 명칭 | `your-ai-model` |

---

## 4. 로컬 테스트 및 개발 가이드

### 4.1 가상 환경 및 패키지 설치
시스템 환경의 파이썬 패키지를 건드리지 않고 의존성을 설치하기 위해 `venv`를 생성하여 실행합니다.

```bash
# 1. 가상환경 생성
python3 -m venv .venv

# 2. 필요한 패키지 설치
.venv/bin/pip install -r requirements.txt
```

### 4.2 로컬 설정 파일 (.env) 작성
1. `.env.example` 파일을 복사하여 `.env` 파일을 생성합니다.
   ```bash
   cp .env.example .env
   ```
   
2. 생성된 `.env` 파일에 각 인증 키 정보 및 대상 게이트웨이 정보를 기입합니다.

### 4.3 로컬 디버그 실행 (Dry-Run)
로컬에서 스크립트를 수동 구동하여 포맷 및 분석 상태를 시뮬레이션할 수 있습니다. 
실제 GitHub API 정보가 누락되어 있는 경우 가상의 Gradle 에러 로그를 기반으로 동작하여 Slack 페이로드를 생성합니다.

```bash
.venv/bin/python3 .github/scripts/analyze_error.py
```

---

## 5. 프로덕션 적용 가이드 (GitHub Actions)

저장소(GitHub Repository) 배포 후 아래 설정을 완료해야 프로덕션 환경에서 정상 작동합니다.

### 5.1 GitHub Secrets & Variables 설정
GitHub 저장소의 **Settings** > **Secrets and variables** > **Actions** 메뉴로 이동하여 다음 변수들을 등록합니다:

* **Repository secrets (민감 정보)**:
  - `AI_API_KEY`: AI API 사용을 위한 인증 키
  - `SLACK_WEBHOOK_URL`: 분석 알림을 발송할 Slack Incoming Webhook URL
* **Repository variables (일반 환경 설정)**:
  - `AI_BASE_URL`: OpenAI 호환 API Gateway Base URL (예: `https://api.yourgateway.com/v1`)
  - `AI_MODEL`: 분석에 사용할 타겟 AI 모델명 (예: `gpt-5.4-mini`)

---

### 5.2 GitHub Actions 워크플로우 설정 (`ai-error-monitor.yml` 예시)
이벤트(이슈 오픈 또는 모니터링 대상 빌드 실패) 발생 시 작동하는 워크플로우 구성 예시입니다. `.github/workflows/ai-error-monitor.yml` 경로에 작성하여 반영해 주십시오.

```yaml
name: AI Error Monitor & Slack Notifier

on:
  issues:
    types: [opened]
  workflow_run:
    workflows: ["Deploy Workflow Name"] # 모니터링 대상이 될 실제 배포 워크플로우 명칭으로 변경
    types: [completed]

jobs:
  analyze_and_notify:
    # 이슈가 오픈되었거나, 모니터링 대상 워크플로우가 실패로 끝났을 때만 실행합니다.
    if: |
      github.event_name == 'issues' || 
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'failure')
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.10'

      - name: Install Dependencies
        run: |
          pip install requests openai

      - name: Run AI Error Analysis & Slack Notification
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          AI_BASE_URL: ${{ vars.AI_BASE_URL }} # Repository variables에서 로드
          AI_MODEL: ${{ vars.AI_MODEL }}       # Repository variables에서 로드
          EVENT_NAME: ${{ github.event_name }}
          ISSUE_BODY: ${{ github.event.issue.body }}
          RUN_ID: ${{ github.event.workflow_run.id }}
        run: |
          python .github/scripts/analyze_error.py
```

