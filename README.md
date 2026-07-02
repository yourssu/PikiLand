# 피키랜드 (PikiLand) 🏰

**피키랜드(PikiLand)**는 GitHub Actions 환경에서 발생한 빌드 오류나 저장소에 오픈된 이슈를 자동으로 감지하여, AI(OpenAI 규격 API Gateway) 분석을 통해 해결 방안을 도출하고 Slack 알림 및 자동 코드 수정(PR 제출)까지 처리하는 **AI 기반 에러 모니터링 및 자가 치유(Self-Healing) 자동화 시스템**입니다.

---

## 1. 아키텍처 및 작동 흐름 (Workflow)

1. **이벤트 감지 (GitHub Actions Trigger)**:
   - 빌드/배포 워크플로우가 **실패**하거나 저장소에 **이슈(Issue)**가 생성되면 모니터링 워크플로우가 자동으로 실행됩니다.
2. **데이터 수집 및 전처리**:
   - 실패한 워크플로우의 실행 ID(`RUN_ID`)를 기반으로 GitHub API에서 에러 로그를 다운로드하여 텍스트를 파싱 및 병합합니다.
   - AI 컨텍스트 한계를 고려해 로그의 Head와 Tail을 분할 추출하고, 구간 병합(Interval Merge) 알고리즘을 사용해 에러 지점들의 문맥을 손실 없이 추출 및 정제합니다.
3. **AI 오류 분석 및 자동 패치**:
   - 가공된 텍스트를 OpenAI 규격 API Gateway(예: `gpt-5.4-mini` 등)로 분석 요청합니다.
   - AI가 오류 원인을 100% 확신하고 패치 지침을 제공하면, 자동으로 새 브랜치를 생성하여 소스 코드를 교체하고 **자동 Pull Request(PR)**를 발행합니다.
4. **Slack 알림 발송**:
   - 원본 에러 로그는 가독성을 위해 **마크다운 접기 문법(`<details>`)**으로 감싸 숨기고, AI 분석 피드백은 **접지 않고 바로 노출**하여 Slack Incoming Webhook을 통해 실시간 전송합니다.

---

## 2. 파일 구조 (Project Structure)

```text
pikiland/
├── scripts/                  # 에러 수집, 분석 및 조치 파이썬 모듈 디렉토리
│   ├── analyze_error.py      # 메인 제어 엔트리포인트 스크립트 (의존성 자가 설치 가드 포함)
│   ├── env_config.py         # 로컬 .env 및 OS 시스템 환경 변수 매핑 로더
│   ├── log_utils.py          # 로그 다운로드, ANSI 정제, 구간 병합 전처리 유틸
│   ├── ai_client.py          # OpenAI 규격 API Gateway 연동 및 마크다운 파서
│   ├── git_utils.py          # 자동 소스 패치 및 GitHub PR 생성 도구 (DRY_RUN 지원)
│   └── slack_notifier.py     # Slack 마크다운 템플릿 가공 및 Webhook 발송기
├── .github/
│   └── workflows/
│       └── ai-error-monitor.yml # 피키랜드 자체 CI 에러 모니터링 워크플로우
├── action.yml                # 타 저장소에서 uses로 땡겨 쓰기 위한 Custom Action 정의서
├── requirements.txt          # 개발 환경 의존성 패키지 명세서
├── .env.example              # 로컬 디버깅 및 테스트를 위한 환경 변수 템플릿
├── .gitignore                # 가상 환경 및 비밀 정보 파일(.env) 업로드 방지
└── README.md                 # 본 설명 문서
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
| `dry_run` | `DRY_RUN` | 자동 소스 패치 및 Git PR 생성 가상화 여부 | `false` |

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

### 4.3 로컬 디버그 실행 및 PR 시뮬레이션 (Dry-Run)
로컬 소스 파일을 변경하거나 Git 히스토리를 오염시키지 않고, 오류 분석 및 PR 생성 전 과정을 테스트하려면 `DRY_RUN=true` 환경 변수를 사용합니다.

```bash
# 로컬 시뮬레이션 구동 (에러 로그 분석부터 가상 PR 본문 생성까지 전체 프로세스 검증)
DRY_RUN=true .venv/bin/python3 scripts/analyze_error.py
```

---

## 5. 타 저장소 적용 가이드 (GitHub Actions Integration)

피키랜드는 **Custom GitHub Action**으로 빌드되어 있어, 다른 저장소에서 이 기능을 적용할 때 소스 코드를 복사할 필요 없이 단 한 줄의 `uses:` 구문으로 적용할 수 있습니다.

### 5.1 타 저장소 Secrets & Variables 설정
피키랜드를 적용할 대상 저장소의 **Settings** > **Secrets and variables** > **Actions** 메뉴로 이동하여 다음 변수들을 등록합니다:

* **Repository secrets (민감 정보)**:
  - `AI_API_KEY`: AI API 사용을 위한 인증 키
  - `SLACK_WEBHOOK_URL`: 분석 알림을 발송할 Slack Incoming Webhook URL (선택 사항)
* **Repository variables (일반 환경 설정)**:
  - `AI_BASE_URL`: OpenAI 호환 API Gateway Base URL (예: `https://factchat-cloud.mindlogic.ai/v1/gateway`)
  - `AI_MODEL`: 분석에 사용할 타겟 AI 모델명 (예: `gpt-5.4-mini`)

### 5.2 타 저장소 워크플로우 설정 (`.github/workflows/ai-error-monitor.yml`)
대상 저장소에 아래 워크플로우 파일을 생성하면, 빌드 실패나 이슈 오픈 시 피키랜드가 호출되어 작업을 대신 수행합니다.

```yaml
name: Run AI Error Monitor

on:
  issues:
    types: [opened]
  workflow_run:
    workflows: ["Deploy Workflow Name"] # 모니터링 대상이 될 빌드/배포 워크플로우 이름으로 변경
    types: [completed]

jobs:
  monitor:
    # 이슈가 오픈되었거나, 모니터링 대상 워크플로우가 실패로 끝났을 때만 실행
    if: ${{ github.event_name == 'issues' || (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'failure') }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: PikiLand AI Error Monitor
        uses: yoon/pikiland@main # 피키랜드 액션 호출
        with:
          ai_api_key: ${{ secrets.AI_API_KEY }}
          slack_webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
          ai_base_url: ${{ vars.AI_BASE_URL }}
          ai_model: ${{ vars.AI_MODEL }}
```

---
