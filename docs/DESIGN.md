# PikiLand 설계 문서 (Design Doc)

> **상태:** Draft v0.1 · **작성일:** 2026-07-04
> **한 줄 정의:** *에러가 발생하면(빌드/런타임) 자동으로 감지 → 맥락을 긁어모아 원인을 진단 → 코드를 고쳐 PR을 올리고 → 스테이지 E2E로 검증까지 하는, 레포에 설치되는 자가치유(Self-Healing) GitHub App.*
>
> 이 문서는 지금까지의 논의를 박제한 기준점입니다. 방향이 흔들릴 때 여기로 돌아옵니다.

---

## 목차

1. [왜 만드는가 (Motivation)](#1-왜-만드는가-motivation)
2. [핵심 원칙 (Design Principles)](#2-핵심-원칙-design-principles)
3. [기능 방향성 (Feature Direction)](#3-기능-방향성-feature-direction)
4. [아키텍처 (Architecture)](#4-아키텍처-architecture)
5. [기술 스택 &amp; 무료 전략](#5-기술-스택--무료-전략)
6. [경쟁·유사 서비스 사례 (Landscape)](#6-경쟁유사-서비스-사례-landscape)
7. [우리의 차별점 (Wedge)](#7-우리의-차별점-wedge)
8. [마일스톤 로드맵](#8-마일스톤-로드맵)
9. [리스크 &amp; 오픈 이슈](#9-리스크--오픈-이슈)
10. [현재 코드베이스 상태](#10-현재-코드베이스-상태)
11. [참고 자료](#11-참고-자료)

---

## 1. 왜 만드는가 (Motivation)

### 1.1 시작된 계기 (실제 경험)

서버 로그에 에러가 찍히면 → 그대로 복사해서 Cursor 채팅창에 붙여넣고 → "왜 이래? 고쳐줘"를 **반복**했다. 그런데 어느 순간 보면 고쳐져 있었다.

이유를 뜯어보니:

- AI는 **버그를 재현하지 않아도** "가능성 있는 원인 여러 개 + 각각의 해결책"을 쭉 내놓는다.
- 그걸 다 적용하다 보면 얼떨결에 고쳐진다.
- 즉, **재현(reproduction)은 필수가 아니었다.** 필요했던 건 (1) 충분한 맥락과 (2) 여러 가설을 시도해보는 것뿐.

### 1.2 그래서 든 생각

> "어차피 내가 계속 '고쳐줘'만 반복하는데, **굳이 사람이 매번 개입해야 할까?**
> 에러 모니터링 툴로 발생 즉시 인식해서 → AI가 알아서 고치고 → **prod가 아닌 stage에서 E2E까지 검증**하고 → PR로 보내면 되는 거 아닐까?"

### 1.3 핵심 가설 (Hypotheses)

| #  | 가설                                                                                  | 검증 방법                                               |
| -- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| H1 | 재현 없이 "맥락 수집 + 다중 가설"만으로 상당수 버그를 고칠 수 있다                    | 실제 에러 N건에 대해 자동 패치 성공률 측정              |
| H2 | "버그 재현" 대신 "스테이지 E2E 통과"를 검증 기준으로 쓰면 무인 운영이 가능하다        | E2E 게이트 통과 PR의 실제 유효성(사람 리뷰 수용률) 측정 |
| H3 | 설정을 극단적으로 간소화하고 무료로 제공하면 개인·소규모 팀이라는 미충족 시장이 있다 | 초기 사용자 확보/리텐션                                 |

### 1.4 만들려는 이유 요약

- **반복 노동 제거:** 로그 복붙 → "고쳐줘" 루프를 사람 손에서 뗀다.
- **즉시성:** 에러 발생 시점에 바로 반응 (사람이 대시보드를 볼 필요 없음).
- **접근성:** 진단을 비개발 언어로도 이해 가능하게, 설정은 클릭 몇 번으로, 비용은 무료 티어로.

### 1.5 두 번째 계기: 온콜팀 없는 운영 현실 (왜 Slack인가)
이 프로젝트는 **동아리 프로덕트를 운영하다가** 나왔다. 전담 **온콜(on-call) 팀이 없다.** 그래서:
- 에러가 나도 **빠른 대처가 어렵고**, 대응하려면 **밖에서 노트북을 꺼내야 하는** 일이 잦았다.
- 개발자는 GitHub 모바일 앱으로 PR 설명 보고 승인이 되지만, **비개발자만 온라인인 시간대**엔 그것도 막힌다.
- 그런데 **작지만 크리티컬한** 수정이라면(=지금 당장 머지해야 서비스가 산다), 그 순간 온라인인 사람이 비개발자뿐이어도 처리돼야 한다.

> **그래서 Slack이다.** Slack에 **비개발자도 이해할 수준으로 쉽고 짧게 핵심만** 전달하고, **너무 급하면 어느 정도 리스크를 감수하더라도 비개발자가 Slack에서 바로 PR을 머지**할 수 있게 한다. Slack은 알림 채널이 아니라 **비개발자의 승인·행동 표면**이다. (§2-6, §3.4, §7-4와 연결)

---

## 2. 핵심 원칙 (Design Principles)

1. **재현이 아니라 맥락 수집 (Context over Reproduction).**
   프로덕션 에러를 똑같이 재현하려 하지 않는다. 대신 "에러 순간 사용자가 뭘 하고 있었는지"를 구조화된 데이터로 긁어와 LLM에 먹인다.
2. **검증은 옮긴 것이지 없앤 게 아니다 (Verification is moved, not removed).**
   Cursor에서 "됐네"를 판단한 검증자는 *사람*이었다. 사람을 빼려면 그 자리에 **스테이지 E2E**를 넣어야 한다.
   ⚠️ 단, **E2E 초록불 = "핵심 플로우 안 깨짐"이지 "그 버그가 진짜 고쳐짐"은 아니다.** (E2E가 해당 경로를 안 밟으면 버그가 남아도 통과) → MVP에선 최종 머지는 사람 승인.
3. **다중 가설을 기계가 선별한다 (Machine-filtered shotgun).**
   원인/패치 후보를 여러 개 생성하고, 각각을 브랜치로 만들어 E2E를 돌려 **초록불 뜨는 것만 채택**한다. 사람이 손으로 걸러내던 필터를 E2E가 대신한다. (업계에서 "parallel hypothesis testing"으로 이미 검증된 패턴 — §6 참조)
4. **이미 있는 걸 적극 재사용 (Buy/Integrate, don't Build).**
   Sentry(에러+breadcrumbs), PostHog(행동 데이터+세션), GitHub Actions(무료 검증 러너)를 직접 만들지 않고 붙여 쓴다.
5. **간소화 & 무료 (Simplicity & Free).**
   사용자는 딱 2번만 연결한다: GitHub App 설치 1번 + 에러 소스(Sentry) 연동 1번. 그 뒤론 사람이 개입 없이 자동. 인프라는 무료 티어 위주.
6. **Slack = 비개발자의 승인·행동 표면 (Slack as the non-dev approval surface).**
   자동으로 진단·수정·검증·PR까지 하되, 머지 결정은 사람이 한다 — 단 그 사람이 **개발자가 아니어도, 노트북 없이 Slack에서** 할 수 있게 한다. 온콜팀이 없는 조직에서 "지금 온라인인 사람이 비개발자뿐"인 상황을 1급 시나리오로 취급한다. 그래서 Slack 메시지는 **짧고·쉽고·핵심만** (비개발 언어). 급하면 리스크를 감수하고 비개발자가 Slack에서 머지 가능. (근거: §1.5)
7. **도메인 암묵지 축적 (Domain knowledge — Ask → Record → Reuse).**
   코드/행동 데이터로는 알 수 없는 것들 — 기획 의도, 비즈니스 규칙, 조직의 암묵지 — 을 별도 지식베이스로 쌓는다. 자율 수정 중 애매하면 사람에게 **묻고(Ask)**, 그 답을 **영구 저장(Record)**, 이후 모든 수정에 **재사용(Reuse)** 한다. 물어볼수록 똑똑해지는 것이 핵심 메커니즘. (원 README의 "AI 학습 기능(메모리)" TODO가 여기로 통합됨. §7 wedge #5와 연결)

---

## 3. 기능 방향성 (Feature Direction)

### 3.1 제품 한 줄 포지셔닝

> **"CodeRabbit은 코드베이스 전체를 맥락에 먹여 *리뷰*만 한다. 우리는 한 스텝 더 — *런타임 에러를 감지해 실제로 고치고, 스테이지 E2E로 검증하고, PR까지* 한다."**

### 3.2 입력(트리거) — 무엇을 감지하나

- **빌드/CI 실패** — GitHub `workflow_run` 실패 (현재 구현됨)
- **이슈 오픈** — GitHub `issues.opened` (현재 구현됨)
- **런타임 서버 에러** — Sentry/PostHog 에러 웹훅 (신규, 이 프로젝트의 핵심 확장)

### 3.3 처리 — 무엇을 하나

1. 에러를 공통 포맷(`ErrorEvent`)으로 정규화
2. **컨텍스트 번들** 조립 (§4.3)
3. LLM으로 원인 N개 + 패치 후보 생성
4. 후보를 브랜치/PR로 생성
5. GitHub Actions에서 테스트 + E2E 검증
6. 결과를 Slack으로 통지 (초록불이면 "승인만 눌러줘")

### 3.4 출력 — 사용자가 받는 것

- **Slack 알림 (비개발자 우선 설계):** 맨 위에 **한 줄 핵심 요약 + 위험도/영향 범위**를 비개발 언어로, 그 아래 원인 설명, **원본 로그는 접어서(`<details>`)** 숨김, PR 링크, (선택) 세션 리플레이 링크.
- **Slack에서 바로 액션:** E2E 통과한 PR에는 **[머지] / [보류] 버튼**을 붙여, 개발자가 없어도(노트북 없어도) 온라인인 사람이 승인·머지 가능. (Slack 승인은 기존 README TODO였음)
- 검증된 PR (E2E 통과 여부 표시).

### 3.5 아직 안 하는 것 (Non-goals, 현 단계)

- 완전 무인 자동 머지 (초기엔 사람 승인 유지)
- 세션 리플레이 "영상"을 LLM에 직접 입력 (영상은 사람 리뷰용, LLM은 구조화 텍스트만)
- 프로덕션 환경에서의 직접 수정/롤백 (스테이지까지만)

---

## 4. 아키텍처 (Architecture)

### 4.1 멘탈 모델: 코어 1개 + 어댑터 여러 개 + 손발(App)

```
[ 입력: Ingestion Adapters ]
  ① GitHub 이벤트   → Probot 웹훅 핸들러 (workflow_run 실패, issue)
  ② 런타임 에러      → HTTP 엔드포인트 / Sentry·PostHog 웹훅

        │  전부 공통 포맷으로 정규화
        ▼
   ErrorEvent { source, repo/installation, payload, context }
        │
        ▼
[ 코어 엔진 (소스 무관) ]
   컨텍스트 번들 조립 → LLM 진단(원인 N + 패치 후보) → 패치 → 검증 → 통지
        │
        ▼
[ 손발: GitHub App ]
   Installation Token = 설치된 모든 레포를 읽고 PR을 올리는 권한
```

> **왜 App인가:** GitHub App의 진짜 가치는 **Installation Token**이다. 레포마다 PAT를 넣지 않아도 "설치된 레포"를 읽고 PR을 올릴 수 있다. 이것이 "레포에 설치되는 서비스"를 가능케 하는 핵심. (CodeRabbit도 동일 구조)

> **중요한 재프레이밍:** 현재는 GitHub Actions 안에서 잠깐 돌고 죽는 **ephemeral 스크립트**다. 런타임 에러를 감지하려면 **항상 떠 있는 서비스**가 필요하다. 그래서 이건 단순한 "Action → App" 전환이 아니라 **"일회성 CI 스크립트 → 상시 호스팅 서비스"** 로의 이동이다.

### 4.2 전체 데이터 흐름

```
① Sentry / PostHog 에러 발생
      │ (웹훅: 구조화된 stacktrace + breadcrumbs + 파일/라인)
      ▼
② GitHub App (상시 가동, 서버리스)
      - installation token으로 레포 전체 읽기
      - 컨텍스트 번들 조립
      - LLM: 원인 N개 + 패치 후보 생성
      - 후보를 브랜치로 push → PR 오픈
      │
      ▼
③ PR이 GitHub Actions 트리거   ← ★ "스테이지 E2E 검증"이 여기서 공짜로 해결
      - 테스트 + Playwright E2E 실행
      │
      ├─ 초록불 → Slack "고침 완료, 승인만 눌러줘" (또는 자동 머지)
      └─ 빨간불 → App이 재시도 / 다른 후보 채택 / "자신 없음" 리포트
```

### 4.3 핵심 프리미티브: 컨텍스트 번들 (Context Bundle)

스택트레이스만 붙여넣는 것과 우리를 가르는 **차별점**. 에러 1건당 이걸 조립해 LLM에 던진다.

```
ContextBundle {
  stacktrace        ← Sentry / PostHog exception
  breadcrumbs       ← Sentry (에러 직전 ~100개 행동 트레일: 네트워크/DB/UI/네비)
  event_trail       ← PostHog (유저 행동 퍼널, 타임스탬프) — HogQL API로 쿼리
  session_link      ← PostHog 리플레이 URL (⚠️ 사람 리뷰용, LLM 입력 X)
  surrounding_logs  ← 서버 로그 중 같은 trace/시간대 앞뒤 N줄
  repo_code         ← installation token으로 해당 파일·라인 주변 (+ 관련 파일)
  domain_knowledge  ← ★축적된 비즈니스 규칙/기획 의도/암묵지 (Q&A로 성장, §2-7)
}
```

- **LLM에 먹이는 것:** 위의 텍스트/구조화 데이터.
- **LLM에 안 먹이는 것:** 세션 리플레이 "영상" 자체 (사람용 링크로만 첨부).
- **`domain_knowledge`가 차별점의 핵심.** Sentry·PostHog가 추적하는 "사용자가 뭘 했나(행동)"로는 절대 못 가리는 것 — 예: 어떤 NullReference가 "버그"인지 "기획상 의도된 deprecated 동작"인지 — 을 이 필드가 판별하게 한다.

### 4.4 접착제: 상관관계 키 (Correlation Key)

Sentry 에러 + PostHog 세션 + 서버 로그를 **한 사건으로 엮는** 공통 키가 필요하다.

- 후보: `trace_id` / `user_id` / `session_id` / 시간대 윈도우
- PostHog에는 Sentry 연동(link error tracking) 기능이 이미 있어 여기 기댈 수 있다.
- **이 correlation 설계가 번들 품질을 좌우한다.**

### 4.5 GitHub App 권한 (헷갈리는 것들 명시)

| 권한                     | 용도                          |
| ------------------------ | ----------------------------- |
| `actions: read`        | 워크플로우 실행 로그 다운로드 |
| `contents: write`      | 코드 읽기 + 패치 커밋         |
| `pull_requests: write` | PR 생성                       |
| `issues: read`         | 이슈 본문 수집                |
| `metadata: read`       | 기본                          |

구독 이벤트: `workflow_run`, `issues`, (필요시) `check_run`

---

## 5. 기술 스택 & 무료 전략

### 5.1 스택

| 레이어                | 선택                                                      | 비고                                                                   |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| GitHub App 프레임워크 | **Probot (Node/TS)**                                | `create-probot-app`로 스캐폴딩. 웹훅 수신·인증·로컬 smee 터널 제공 |
| 코어 엔진 로직        | **기존 Python 재사용 (하이브리드)** 또는 풀 TS 포팅 | MVP는 하이브리드 추천(검증된 로직 보존). 언어 결정은 열려있음          |
| 에러 탐지             | **Sentry** (+ 선택적으로 PostHog)                   | breadcrumbs가 핵심 입력                                                |
| 행동 데이터           | **PostHog**                                         | error tracking → session replay 링크, HogQL API                       |
| 검증 러너             | **GitHub Actions**                                  | 별도 스테이지 인프라 대신 CI를 샌드박스로 재활용                       |
| 호스팅                | 서버리스 (예: Cloudflare Workers / Vercel Functions)      | 웹훅 수신은 상시 서버 없이 무료 티어로 가능                            |
| 통지                  | Slack Incoming Webhook                                    | 현재 구현됨                                                            |

### 5.2 "무료"의 정직한 경계

- **무료 가능:** Sentry/PostHog 무료 티어, GitHub Actions 무료 분, 서버리스 무료 티어.
- **진짜 비용:** **LLM 토큰 + CI 실행 분.** 에러당 원인 N개 + 후보 패치 여러 개 E2E를 돌리면 누적된다.
- **무료 유지의 핵심 장치:** confidence 게이팅 · 중복 제거(같은 에러 반복 무시) · rate limit. (기존 TODO와 직결)

### 5.3 LLM 소싱 전략 & "이중결제 안 함"

**이중결제 회피(무료 wedge의 디테일):** 사용자는 **Sentry 무료 에러트래킹만** 쓰고, AI 진단은 **우리가 제공(bring-your-own-LLM)**. 즉 사용자는 Sentry의 AI 애드온(Seer, $40/contributor·월)을 **살 필요가 없다.** AI 값은 시스템 전체에서 한 번만 발생.

**구독 토큰 재활용에 대한 정직한 한계:**

| 소스                      | 상시 백엔드에서 재활용 | 비고                                                                                                                                                       |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude 플랜(Pro/Max/Team) | ⚠️ 제한적            | `ant auth login` OAuth는 **개발자 머신 인터랙티브용**. 토큰 단기 만료 → 무인 상시 서비스엔 부적합. 서버/CI는 공식적으로 **API 키/WIF** 권장 |
| GPT/ChatGPT 플랜          | ❌ 불가                | ChatGPT 구독 ≠ OpenAI API. 프로그램 호출 경로 없음 (별도 과금)                                                                                            |

> 참고: CodeRabbit·Copilot은 사용자 개인 구독 토큰을 재활용하는 게 아니라 **자체 구독료를 받고 자체 API를 쓴다.** "우리 팀 플랜 토큰 끌어쓰기"와는 다른 모델.

**따라서 현실적 저비용 LLM 전략 (상시 App):** API pay-as-you-go + 강한 비용 통제

- **Prompt caching** — 레포 컨텍스트 캐시로 캐시분 최대 ~90% 절감 (에러마다 코드베이스 재전송 안 함)
- **모델 계층화** — 트리아지/중복판정은 싼 모델, 실제 패치 생성만 상위 모델
- **Batch API** — 급하지 않은 작업 50% 할인
- **게이팅·중복제거·rate limit** — 애초에 호출 수 억제
- (MVP 개발 단계 한정) 구독 기반 인터랙티브 실행은 *본인 머신에서 수동 루프* 로만

---

## 6. 경쟁·유사 서비스 사례 (Landscape)

> **핵심 요약:** 이 공간은 이미 붐비고 자금도 몰려 있다. 특히 **Sentry Seer는 우리가 그리는 그림과 거의 동일한 것을 이미 GA로 제공**한다. 정직하게 인식하고 "그럼 우리 wedge는?"을 §7에서 답한다.

### 6.1 Sentry Seer / Autofix — ⭐ 가장 직접적인 경쟁자

- 에러 → **Root Cause Analysis → Solution → Code Generation → PR 생성**의 3단계. 우리가 그리는 흐름과 사실상 동일.
- **자동 트리거 조건**까지 있음: 이벤트 10건 이상, 최근 14일 내, "fixability score" 충족 시 자동 실행.
- 트레이스 연결로 **크로스 서비스·멀티 레포** 디버깅 및 PR 가능.
- 주장: root cause 정확도 94.5%, 38,000+ 이슈 수정.
- **인터랙티브 협업 + 커스텀 룰까지 있음:** 추론 중 사용자가 끼어들어 맥락/피드백 제공 가능, 이해 공백 시 **사용자에게 질문**, "/config는 건드리지 마" 같은 커스텀 instruction 지원.
- **가격: 무료 아님.** 무료 Developer 플랜 불가 → 유료 Team/Business 필요 + Seer 애드온 **$40/active contributor·월** (2026-01 이후), Issue Fix는 실행당 과금.
- **하지만 안 하는 것 = 우리 빈틈:** Seer의 질문/맥락은 **그 세션 한정(휘발)**, 커스텀 룰은 "코드 규칙"이지 **비즈니스/제품 암묵지의 지속적 축적이 아니다.** → §7 wedge #5.
- **시사점:** "에러→PR 자동수정"과 "질문하기"는 신규 발명이 아니다. Sentry 안에 이미 있다. 우리의 여지는 **지속·축적되는 도메인 지식 메모리 + 통합 + 간소화 + 무료.**

### 6.2 CodeRabbit — 레포 맥락 기반 리뷰 (사용자가 언급)

- GitHub App으로 **코드베이스 전체를 맥락화**해 PR 리뷰, 인라인 코멘트, 원클릭 수정 제안.
- 2026 기능: Issue Planner(이슈→코딩 플랜), SAST 통합, 코드 그래프 분석, 런타임 트레이스/CI/관측 신호로 컨텍스트 확장 중.
- **시사점:** "리뷰"에 강함. 우리의 차별은 "리뷰"가 아니라 **런타임 에러를 실제로 고치고 검증**하는 것.

### 6.3 GitHub Copilot Autofix — 플랫폼 내장

- 코드 스캐닝(CodeQL) 경고에 대해 LLM이 수정안 생성 → "Create PR with fix"로 PR.
- Copilot coding agent가 PR을 열고 사람이 리뷰/머지.
- **시사점:** 보안 취약점/정적 분석 경고 중심. 런타임 에러+행동 맥락은 우리 영역.

### 6.4 AI SRE 에이전트 — Cleric, Resolve.ai, Traversal

- **Cleric:** 자율 AI SRE. 자동 서비스 매핑 + **병렬 가설 테스트(confidence tracking)** + 지속 학습. Gartner Cool Vendor 2025.
- **Resolve.ai:** 2026년 2월 $125M 투자, 기업가치 $1B. "80% 자율 해결" 목표, **병렬 가설 조사**.
- **패턴:** LLM이 에이전트로서 로그/메트릭/의존성 그래프를 조회하고 샌드박스 파드에 shell해 증거를 수집하며 다단계 추론.
- **시사점:** 우리의 "shotgun/다중 가설" 직관은 업계 표준 패턴(parallel hypothesis testing)으로 검증됨. 단, 이들은 **엔터프라이즈·유료·인프라 진단 중심**이고 "코드 수정+PR"보다 "원인 규명"에 무게.

### 6.5 PostHog — 데이터 소스이자 부분 경쟁

- Error tracking + session replay 링크 + exception steps(breadcrumb) + HogQL API.
- Max AI 등 자체 AI 기능 보유.
- **시사점:** 우리에겐 주로 **행동 데이터 소스**. 직접 만들 필요 없음.

### 6.6 한눈에 보기

| 서비스                | 핵심                              | 런타임 에러 | 코드 수정+PR |      E2E 검증      | 가격/대상               |
| --------------------- | --------------------------------- | :---------: | :----------: | :----------------: | ----------------------- |
| **Sentry Seer** | 에러→원인→PR                    |     ✅     |      ✅      |     부분(리뷰)     | 유료(애드온 $40/인·월) |
| CodeRabbit            | PR 리뷰                           |     ✗     |  제안 위주  |         ✗         | 유료                    |
| Copilot Autofix       | 보안경고 수정                     |     ✗     |      ✅      |         ✗         | 플랫폼                  |
| Cleric/Resolve        | 자율 SRE 진단                     |     ✅     |     약함     |         ✗         | 엔터프라이즈            |
| **PikiLand**    | 에러→수정→**E2E검증**→PR |     ✅     |      ✅      | **✅(목표)** | **무료/간소**     |

---

## 7. 우리의 차별점 (Wedge)

Sentry Seer가 거의 같은 걸 한다는 사실을 받아들인 위에서, 현실적인 wedge는:

1. **간소화 + 무료 (개인·소규모 시장).**
   Seer·Resolve는 유료/엔터프라이즈다. "GitHub App 설치 + 소스 연동 1번"으로 끝나는 극단적 간소화 + 무료 티어는 **인디 개발자·소규모 팀**이라는 미충족 시장을 노린다.
2. **스테이지 E2E 검증 루프.**
   많은 도구가 **검증 없이 PR을 던진다**(또는 리뷰만). 우리는 GitHub Actions를 재활용해 **PR 자체를 E2E로 통과시킨 것만** 올린다 — "고쳤다"가 아니라 "고치고 통과까지 확인했다".
3. **멀티 소스 통합 컨텍스트 번들.**
   대부분 단일 소스(Sentry는 자기 데이터, CodeRabbit은 코드). 우리는 **빌드 실패 + 이슈 + Sentry 런타임 + PostHog 행동**을 하나의 번들로 합쳐 진단 품질을 높인다.
4. **비개발자가 실제로 행동하게 (Non-dev actionability via Slack).**
   단순히 "이해하기 쉬운 설명"이 아니라, **온콜팀 없는 조직에서 비개발자가 Slack에서 직접 승인·머지**하게 하는 것이 목적(§1.5). "밖에서 노트북 꺼내기" / "개발자만 승인 가능"이라는 실제 마찰을 없앤다. 비개발 언어 진단은 이 행동을 가능케 하는 수단.
5. **비즈니스/암묵지 메모리 (가장 방어 가능한 wedge).**
   Seer도 질문하고 커스텀 룰을 받지만 **그 세션 한정**이다. 우리는 애매할 때 물어본 답을 **영구 축적해 모든 후속 수정에 재사용**한다 (§2-7, §4.3 `domain_knowledge`). 순수 코드/행동 데이터 도구가 **구조적으로 못 하는** 영역 — "이 코드가 왜 이래야 하는가(의도·규칙)"를 아는 것. 물어볼수록 똑똑해진다.

> **정직한 결론:** 기술적으로 완전히 새로운 건 없다 (에러→PR도, 질문하기도 Seer에 있다). 우리의 베팅은 **"통합 + 간소화 + 무료 + 검증된 PR + 축적되는 도메인 지식"의 패키징**이 특정 사용자층(인디·소규모 팀)에게 충분히 가치 있다는 것. 단 wedge #5(지식 메모리)는 강력하지만 **어려운 문제**(지식 캡처·낡음·검색·신뢰) — 서사로는 지금 박되, 구현은 M4~. (H3 검증 대상)

---

## 8. 마일스톤 로드맵

> 원칙: **한 번에 다 만들지 않는다.** Probot 포팅(검증된 코드 재호스팅, 쉬움)과 런타임 에러 평면(신규 시스템, 어려움)을 분리한다.

### M0 — 현재 (Done)

- Python GitHub Action: 빌드 실패/이슈 감지 → 로그 전처리 → LLM 진단 → (조건부) 자동 PR → Slack. 로컬 DRY_RUN 동작 확인됨.

### M1 — GitHub App으로 재호스팅

- `create-probot-app` 스캐폴딩, GitHub App 등록/권한 설정.
- **지금 Action이 하는 일을 그대로** App(상시 서비스)에서 수행.
- 기존 Python 로직 하이브리드 연결.
- (개선) LLM JSON 응답을 프롬프트 요구 → `response_format`/tool calling으로 전환해 파싱 취약성 제거.

### M2 — 런타임 에러 어댑터

- Sentry 웹훅 수신 엔드포인트(+시크릿 인증) 추가.
- `service-name → repo + installation` 매핑 컴포넌트.
- 컨텍스트 번들 v1 (stacktrace + breadcrumbs + repo code).

### M3 — 검증 루프 (E2E)

- PR 생성 시 GitHub Actions에서 테스트/Playwright E2E 실행.
- 다중 후보 패치 → 각 브랜치 E2E → 초록불 채택.
- confidence 게이팅 + 중복 제거 + rate limit.

### M4 — 맥락 심화 & 승인 UX

- PostHog 행동 데이터/세션 링크 편입.
- Slack에서 PR 승인/머지 (기존 TODO).
- correlation key 정교화.

---

## 9. 리스크 & 오픈 이슈

| #   | 리스크                                                                           | 대응                                                                                       |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1  | **Sentry Seer 등 강력한 기성품 존재**                                      | 간소화·무료·통합·검증 wedge로 차별화 (§7). 시장/리텐션으로 조기 검증                   |
| R2  | **E2E 초록불 ≠ 버그 실제 수정**                                           | MVP는 사람 승인 유지. E2E 커버리지 명시                                                    |
| R3  | **무인 shotgun의 잘못된 패치 유입**                                        | E2E 게이트가 필터. confidence 임계값                                                       |
| R4  | **열린 HTTP 엔드포인트 = 토큰/PR 남용·비용**                              | 서명/시크릿 인증, rate limit, dedup                                                        |
| R5  | **PII/프라이버시** (로그·행동데이터를 LLM에 전송)                         | Sentry data scrubbing, 마스킹                                                              |
| R6  | **"무료"의 실제 비용은 LLM/CI**                                            | 게이팅·중복제거로 호출량 억제                                                             |
| R7  | **운영 부담** (상시 호스팅, App private key, webhook secret)               | 서버리스 + 시크릿 관리                                                                     |
| R8  | **LLM JSON 파싱 취약성** (현 코드)                                         | structured output/tool calling 전환 (M1)                                                   |
| R9  | **구독 토큰 백엔드 재활용 불가** (GPT 전면 불가, Claude 상시서비스 부적합) | 상시 App은 API pay-as-you-go + prompt caching/모델계층화/Batch/게이팅으로 저비용화 (§5.3) |
| R10 | **도메인 지식 메모리는 강력하나 난이도 높음** (캡처·낡음·검색·신뢰)     | 서사는 지금, 구현은 M4~. 초기엔 Ask→Record 캡처 루프만 최소 구현                          |
| R11 | **비개발자 머지 = 리스크** (의도적으로 감수하는 트레이드오프, §1.5) | 가드레일: **E2E 초록불 통과 + 작고 스코프 좁은 변경**에만 Slack 머지 버튼 노출. 위험도 높거나 광범위하면 개발자 승인 필수로 강등. 되돌리기(revert) 원클릭 + 사후 개발자 알림 |

### 열린 결정 사항 (Open Questions)

- 코어 엔진: 하이브리드(Node↔Python) vs 풀 TS 포팅?
- 에러 소스: Sentry 단독 시작 vs PostHog 병행?
- correlation key 표준을 무엇으로?
- 자동 머지 허용 조건(E2E 커버리지 임계)?

---

## 10. 현재 코드베이스 상태

| 단계        | 파일                                                       | 상태                                                                        |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| 이벤트 감지 | `action.yml`, `.github/workflows/ai-error-monitor.yml` | ✅ issues + workflow_run                                                    |
| 로그 수집   | `scripts/log_utils.py: download_github_workflow_logs`    | ✅                                                                          |
| 전처리      | `scripts/log_utils.py: truncate_log_for_ai`              | ✅ (ANSI 제거, 진행바 치환, Head/Tail + 에러구간 병합) — 가장 견고         |
| LLM 진단    | `scripts/ai_client.py: analyze_with_ai`                  | ⚠️ 동작하나 JSON 프롬프트 방식 → 파싱 취약                               |
| 자동 PR     | `scripts/git_utils.py: create_auto_patch_pr`             | ✅ old→new 치환 +`gh pr create`, DRY_RUN 지원                            |
| Slack       | `scripts/slack_notifier.py`                              | ✅ (webhook 없으면 stdout)                                                  |
| 엔트리      | `scripts/analyze_error.py`                               | ✅ 더미 로그 폴백. ⚠️`subprocess` import 누락(자동설치 경로에서만 발현) |

**로컬 테스트:**

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# 흐름만 (크리덴셜 없이)
DRY_RUN=true EVENT_NAME=workflow_run .venv/bin/python3 scripts/analyze_error.py
# 실제 LLM 진단 (.env에 BASE_URL/API_KEY/AI_MODEL 기입 후)
DRY_RUN=true EVENT_NAME=workflow_run .venv/bin/python3 scripts/analyze_error.py
```

---

## 11. 참고 자료

**에러/행동 데이터**

- [Sentry — Using Breadcrumbs](https://docs.sentry.io/product/issues/issue-details/breadcrumbs/)
- [Sentry — Breadcrumbs feature](https://sentry.io/features/breadcrumbs/)
- [Sentry — Seer / Autofix](https://docs.sentry.io/product/ai-in-sentry/seer/autofix/)
- [Sentry — Seer GA changelog](https://sentry.io/changelog/seer-sentrys-ai-debugger-is-generally-available/)
- [PostHog — Error tracking](https://posthog.com/docs/error-tracking)
- [PostHog — Capture exceptions](https://posthog.com/docs/error-tracking/capture)
- [PostHog — Link error tracking](https://posthog.com/docs/ai-observability/link-error-tracking)

**경쟁/유사 서비스**

- [CodeRabbit Docs](https://docs.coderabbit.ai/)
- [GitHub — Copilot Autofix for code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/copilot-autofix-for-code-scanning)
- [Cleric — AI SRE](https://cleric.ai/)
- [Best AI SRE Tools 2026 (Resolve.ai vs Cleric vs Rootly)](https://prommer.net/en/tech/guides/best-ai-sre-tools-2026/)
- [awesome-ai-sre (100+ tools)](https://github.com/agamm/awesome-ai-sre)

**빌드 도구**

- [Probot](https://probot.github.io/)
