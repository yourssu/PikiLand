# Incidents DB 및 API 구현 계획 — 에이전트 작업 지침

작성일: 2026-11-25
상태: 2026-11-25 사용자 승인 후 구현 완료. 검증 및 운영 연결 제한은 `../INCIDENTS_IMPLEMENTATION.md` 참조.
기준: 현재 `/Users/yoon/PikiLand` 워크트리, HEAD `89d427f` (`feat: implement repo backend`).

## 1. 목표와 변경 경계

현재 repository 구현에 incidents D1 테이블과 Chanfana API를 추가한다. 기존 GitHub 로그인, repository API, README, 프런트엔드의 변경은 최소화한다. 이번에 사용자가 명시적으로 승인한 계획 범위는 다음과 같다.

- incidents 목록·상세·삭제 API 및 engine 전용 사건 덮어쓰기 POST.
- 사건 POST에 필요한 engine 토큰 인증과 사건 매핑.
- 제공된 명세의 OIDC engine 토큰 발급 API.
- 서버 내부 사건 생성, 실행 예약 및 신뢰된 실행 식별자 연결 함수.
- Bun 기반 테스트와 Chanfana에서 생성한 OpenAPI 검증.

다음은 이번 구현 대상이 아니다.

- Fluent Bit 수집 API, 오류 탐지·분석기, 실제 GitHub Actions 실행/dispatch, 실행 완료 webhook/poller, 자동 큐 소비기.
- Fluent Bit 토큰 발급, 별도 토큰 폐기 API, 엔진 설정 API.
- 사용자 직접 사건 생성, 별도 PATCH/PUT 사건 API.
- 로그인 세션 개편, 설치 선택 UI, README 수정, 기존 전역 오류 포맷 개편.
- 원격 DB 마이그레이션·배포 및 `/Users/yoon/pikiland-engine` 변경.

자동 실행은 전체 시스템의 핵심 요구사항으로 유지하되 이번 산출물에 구현 완료로 표시하지 않는다. 운영에서는 후속 로그 분석기와 dispatcher가 내부 함수를 호출해야 한다. 테스트에서는 합성 데이터로 사건·실행 예약·실행 연결을 준비한다.

## 2. 근거와 우선순위

1. 사용자의 최신 대화상 결정.
2. `/Users/yoon/Downloads/pikiland-openapi-tokens.json` 및 `/Users/yoon/Downloads/pikiland-schema-tokens.dbml`.
3. 현재 워크트리의 구현 관례.

원본 명세 파일은 수정하지 않는다. PostgreSQL DBML은 논리 명세로 해석하고 물리 구현은 D1으로 한다. 오래된 파이프라인 그림이나 명세 예시는 이후 대화상 결정을 덮어쓰지 않는다.

명세와 대화상 결정의 차이:

| 항목 | 원본 | 이번 적용 |
| --- | --- | --- |
| 사건 POST | 사용자 세션을 상속하는 생성 API, ID 응답 | engine 전용, 토큰에 연결된 사건 전체 덮어쓰기 |
| POST 응답 | `IncidentId` JSON | 본문 없는 `201 Created`, `Location` 유지 |
| 수정 대상 | 요청에 ID 없음 | 서버의 토큰→사건 매핑으로 결정; body에 ID 추가 금지 |
| engine TTL | 86400초 예시 | 최대 21900초(6시간 5분) |
| 페이지 크기 | 명세의 공통 페이지 파라미터 | 기본 10, 최대 30 |
| 사용자 인증 | SessionBearer | 조회·삭제는 기존 cookieAuth 유지; 로그인 개편 제외 |

## 3. 현재 코드 분석 및 기준선

- `src/index.ts`: Hono + `fromHono`, `/api` prefix. `/auth`는 기존 별도 라우터.
- 전역 `jwtMiddleware`가 현재 `/api/*`에 사용자 쿠키를 요구한다. 그대로 두면 engine Bearer와 OIDC 요청도 쿠키를 요구하므로, 신규 두 POST 경로만 인증 분리가 필요하다.
- `src/endpoints/repository.ts`: `OpenAPIRoute`, `getValidatedData`, `contentJson` 관례를 그대로 사용한다.
- `src/repositories/access.ts`: `githubToken`, `authorize`를 사용자 조회·삭제 권한 검사에 재사용한다.
- `src/repositories/store.ts`: `findRepository` 재사용. 신규 사건 조회는 비밀 설정 복호화가 필요 없다.
- 현재 DB는 oauth_states, sessions, repositories만 존재한다. incidents, repository_tokens, 실행 매핑은 없다.
- `tests/repositories.test.ts`: Bun + SQLite D1 adapter + GitHub fetch mock. Vitest를 추가하지 않는다.
- 현재 테스트 10개 통과. `bun run typecheck`는 기존 `src/endpoints/listRepositories.ts:40`의 boolean/number 비교 오류(TS2367)로 실패한다. `RepositoryRow.is_active`가 boolean인데 SQL은 INTEGER이고 목록은 숫자 1과 비교한다. 이번 계획 작성 중 수정하지 않았다.
- 구현 시 위 타입 문제는 D1 반환값을 확인하여 row 타입과 boolean 변환만 좁게 정리하는 선행 수정으로 분리한다. 활성/비활성 repository 조회 회귀 테스트를 추가하고, incidents 코드 변경과 구분하여 보고한다. 다른 repository 리팩터링은 하지 않는다.
- 현재 Swagger/OpenAPI 경로는 항상 활성화되어 있고 이전 개발 전용 설정과 다르다. 이 작업에서 임의 복원하거나 변경하지 않는다. 테스트·Swagger 패키지나 정적 UI 자산을 새로 배포물에 넣지 않는다. 배포 문서 노출 정책을 다시 바꾸려면 별도 확인한다.

## 4. 확정된 동작

### 사용자 조회·삭제

- 목록·상세: 현재 GitHub 사용자 세션 및 repository 접근 권한 확인.
- 삭제: 같은 인증에 admin 또는 maintain 권한 추가 확인.
- 비활성 repository에서도 목록·상세·삭제 허용.
- 모든 사건 SQL에 `repo_id`와 `incident_id` 범위를 적용한다. 다른 repository의 사건 ID로 접근할 수 없어야 한다.
- 삭제는 `200` 및 `{ incident_id }`를 반환한다. 없는 사건·잘못된 repository 범위는 기존 repository 구현과 명세의 403 관례를 따른다. 임의로 404/409를 추가하지 않는다.
- 목록 정렬: `occurred_at DESC, incident_id DESC`.
- 페이지: page 기본 1, per_page 기본 10, 최대 30. `incidents`, `page_stats` 구조 유지. 총개수는 해당 repository 기준이며 목록에 context를 싣지 않는다.

### 내부 생성 및 engine 업데이트

- 서버가 오류 로그를 바탕으로 먼저 사건을 생성한다. 외부 사용자 생성 API는 없다.
- 초기 `pr_generated=false`, `pr_link=null`. 발생 시각과 summary는 내부 호출자가 제공한다.
- 초기 context에는 감지에 사용한 로그를 `fluent_bit` 배열로 보관하고, 그 로그의 JSON 텍스트를 담은 `user` 메시지 1개 이상을 `llm.messages`에 기록한다. 임의 LLM 응답을 만들지 않는다.
- engine 토큰은 하나의 repository·사건·실행에만 연결한다. POST body에서 ID를 얻거나 최신 사건을 추측하지 않는다.
- POST는 date, pr_generated, pr_link, summary, context를 모두 교체한다. 부분 병합 금지, 기존 incident_id/repo_id/created_at 유지.
- 업데이트 후 새로운 사건 생성, 실행 예약 또는 재트리거 금지.
- 성공은 body 없는 201 및 `/api/repositories/{repo_id}/incidents/{incident_id}` Location.
- engine 토큰으로 목록·상세·삭제를 허용하지 않는다. 사용자 쿠키나 Fluent Bit 토큰으로 사건 POST를 허용하지 않는다.
- 단순 POST만으로 Actions job 완료를 추정하거나 토큰을 자동 폐기하지 않는다. 조기 폐기는 신뢰된 내부 완료 처리 함수로 제공하며 공개 API는 추가하지 않는다.
- 비활성 전환 후 신규 실행 예약·engine 토큰 발급은 금지한다. 이미 유효하게 발급된 토큰의 결과 반영은 허용하여 진행 중 실행 결과를 잃지 않게 한다.

## 5. API 작업표

| Method / 경로 | operationId | 인증 | 성공 응답 |
| --- | --- | --- | --- |
| GET `/api/repositories/{repo_id}/incidents` | listIncidents | 기존 사용자 쿠키 + 읽기 권한 | 200 IncidentListResponse |
| GET `/api/repositories/{repo_id}/incidents/{incident_id}` | getIncident | 기존 사용자 쿠키 + 읽기 권한 | 200 IncidentEnvelope |
| DELETE `/api/repositories/{repo_id}/incidents/{incident_id}` | deleteIncident | 기존 사용자 쿠키 + admin/maintain | 200 IncidentId |
| POST `/api/repositories/{repo_id}/incidents` | createIncident | 자체 engine Bearer | 201, 본문 없음, Location |
| POST `/api/repositories/{repo_id}/tokens/engine` | genenginetoken | GitHub Actions OIDC | 201 EngineTokenResponse, Cache-Control: no-store |

engine 발급 body는 기존 `{ expires_in }`만 받으며 사건 ID·예약 ID·run ID를 추가하지 않는다. TTL은 1..21900 정수. 응답은 repo_id, token, token_type=bearer, purpose=engine, expires_in, issued_at, expires_at을 유지한다.

새 경로의 오류는 명세의 401/403 및 기존 Chanfana 검증·서버 오류 관례를 사용한다. engine/OIDC 401에는 각 인증에 맞는 WWW-Authenticate를 포함한다. 신규 Bearer 경로에는 원본 Problem Details 스키마를 적용할 수 있으나 기존 사용자 인증 및 전역 onError는 변경하지 않는다. 내부 SQL·암호문·토큰 원문은 오류에 포함하지 않는다.

## 6. D1 데이터 설계

### incidents

신규 `0004_create_incidents.sql`만 추가한다. 기존 0001~0003은 수정하지 않는다.

| 컬럼 | D1 표현 및 조건 |
| --- | --- |
| incident_id | INTEGER PRIMARY KEY AUTOINCREMENT; 삭제 후 ID 재사용 방지 |
| repo_id | INTEGER NOT NULL, repositories(repo_id) FK, ON DELETE CASCADE |
| occurred_at | TEXT NOT NULL; date를 UTC ISO 8601 고정 정밀도로 정규화 |
| pr_generated | INTEGER NOT NULL, 0 또는 1 |
| pr_link | TEXT nullable; true이면 비어 있지 않은 URI, false이면 null |
| summary | TEXT NOT NULL; 원본에 없는 최소 길이 추가 금지 |
| context | TEXT NOT NULL, JSON 객체 |
| created_at | 서버 생성 시각, 수정 시 보존 |

- DB CHECK: PR 값 일관성, 유효한 JSON, llm 객체, fluent_bit 배열, llm.messages 비어 있지 않은 배열.
- SQLite CHECK의 NULL 통과 특성 때문에 필수 JSON 경로의 누락과 JSON null 모두 명시적으로 거부한다.
- JSON 형식 검사 후 구조/배열 길이를 검사하도록 CASE 등으로 보호한다.
- 인덱스: `(repo_id, occurred_at DESC, incident_id DESC)` 및 복합 FK 참조용 `(repo_id, incident_id)` UNIQUE.
- JSON은 평문 TEXT로 보존한다. 명세에 없는 context 암호화·마스킹·데이터 제거는 하지 않는다.
- UTC 정규화는 시간순 정렬을 위한 표현 변경이며 사건 발생 시점을 보존한다. 다른 timezone offset의 동일 시각 정렬을 테스트한다.

### 실행 예약·토큰 매핑 — DBML에 없는 최소 추가 구조

별도 신규 migration에 `incident_engine_runs`, `incident_engine_run_incidents`, `repository_tokens`, OIDC 재사용 방지 저장소를 추가한다. 이는 이번에 승인된 engine 인증·매핑을 위한 추가이며 원본 DBML에 이미 존재한다고 설명하지 않는다.

- incident_engine_runs: 내부 식별자, repo_id, 예약/활성/완료/취소 상태, 허용 workflow_ref, 신뢰된 run_id/run_attempt, 예약·활성·완료 시각. repository FK만 갖고 사건 삭제 후에도 활성 실행을 추적할 수 있게 한다.
- incident_engine_run_incidents: 실행당 하나의 사건 연결. repo_id를 포함한 복합 FK로 실행·사건이 같은 repository에 속함을 보장한다. 사건 삭제 시 연결은 cascade 삭제되고 토큰도 이 연결을 참조하여 무효화된다. 활성 실행 레코드는 유지되므로 실제 job의 완료 확인 전 슬롯이 풀리지 않는다.
- 한 repository에서 활성 실행은 최대 1개. DB UNIQUE/조건부 갱신으로 보장한다. 다른 repository는 독립적으로 활성화할 수 있다.
- 순차 예약 순서는 내부 예약 ID 기준 FIFO. 자동 소비기는 만들지 않는다. 내부 활성화 함수가 앞선 미완료 실행 존재 시 다음 실행을 활성화하지 않는다.
- repository_tokens는 원본 hash/purpose/expiry/revocation/runner identity 필드를 보존하고 실행 연결 키를 추가한다. 토큰→실행→사건의 복합 FK로 repository 불일치를 차단한다.
- Fluent Bit 목적의 원본 확장 가능성은 보존하지만 이번에는 발급/인증 API를 만들지 않는다.
- 같은 repository·purpose의 현재 토큰 최대 1개. 같은 실행의 새 OIDC 요청은 기존 토큰 폐기 후 교체 가능. 다른 활성 실행으로 덮어쓰지 않는다.
- OIDC jti는 repository 삭제 후에도 유효기간 동안 재사용을 막도록 독립 저장한다. 원문 OIDC JWT를 저장하지 않는다.
- 토큰 원문은 발급 응답에만 반환하고 SHA-256 hash만 저장한다. 충분한 길이의 암호학적 난수를 사용한다.
- 사건 삭제 시 연결된 실행·토큰을 삭제/무효화한다. 실제 Actions 중단은 이번 범위 밖이다. 실행 이력의 활성 슬롯은 신뢰된 완료 확인 전까지 유지하여, 사건 삭제가 동시 실행 허용으로 이어지지 않게 한다. 아직 활성화되지 않은 예약은 사건 삭제 시 취소 처리한다. 활성 실행은 내부 완료 함수가 run 식별자로 별도 정리할 수 있게 한다.
- repository 삭제는 하위 사건·토큰·예약 정리. 이미 시작한 외부 job의 정지는 보장하지 않는다.
- 토큰 만료 자체를 실제 job 완료로 취급하지 않는다. 신뢰된 완료 처리 전에는 다음 실행을 활성화하지 않는다.

## 7. 인증과 실행 연결

### 기존 인증 보존

`src/index.ts`에서 기존 사용자 쿠키 인증은 유지한다. 신규 engine 발급 POST와 사건 POST의 정확한 method/path 조합만 별도 인증 라우트로 분리한다. `/repositories/*` 전체나 incidents 하위 전체를 쿠키 검사에서 제외하지 않는다. 라우트 순서 변경 시 engine 요청에 쿠키가 요구되지 않고 GET/DELETE는 계속 보호되는지 회귀 테스트한다.

### OIDC 검증

- GitHub 공식 issuer, 고정 JWKS 주소, 허용 알고리즘, 서명, audience, 만료·발급 시각, 필수 jti를 검증한다. 토큰 내부의 임의 key URL은 사용하지 않는다.
- repository_id, repository owner/name, workflow_ref/ref, event_name, run_id, run_attempt를 검사한다.
- 허용 audience와 정확한 workflow allowlist는 배포 설정으로 공급한다. 설정 누락 시 발급하지 않는다. 운영 값을 임의로 하드코딩하지 않는다.
- GitHub 서명과 repository 일치만으로 발급하지 않는다. 서버가 사전에 연결한 활성 실행의 run_id/run_attempt/workflow_ref와 일치해야 한다.
- 공개 요청의 query/body/미검증 JWT에서 사건 매핑이나 실행 예약을 생성하지 않는다. '현재 활성 사건'을 임의 runner가 선점하는 방식도 금지한다.
- 신뢰된 실행 연결 정보가 없으면 발급 거부. 이번에는 dispatcher가 없으므로 운영에서 이 연결을 자동으로 만드는 기능은 없다.
- 암호 검증은 기존 라이브러리가 지원하는 검증 기능을 확인하여 재사용한다. 부족하면 검증된 JWT/JWKS 라이브러리의 최소 의존성만 추가하고 이유를 보고한다. 직접 암호 알고리즘을 구현하지 않는다.

### 원자성

- 내부 사건 생성과 실행 예약은 D1 트랜잭션 가능한 batch 또는 동등한 원자적 SQL로 처리한다.
- 토큰 교체와 jti 소모는 한 원자적 작업이어야 한다. 재사용·경합 실패가 기존 정상 토큰을 폐기하지 않아야 한다.
- 사건 POST의 최종 UPDATE에서도 토큰 미폐기·미만료 및 사건/실행 연결 조건을 확인한다. 사전 검증 후 DELETE/폐기와 경합해도 사건을 되살리지 않는다.
- 같은 사건 동시 전체 덮어쓰기는 최종 성공 쓰기가 남는다. 원본에 없는 버전 헤더/부분 수정 규약은 추가하지 않는다.
- 토큰 교체·완료·삭제와 POST가 경합하는 경우를 실제 D1 로컬 검증에 포함한다.

## 8. Chanfana 스키마

`src/incidents/schema.ts`에 원본 참조 스키마를 필요한 범위만 옮긴다. 별도 수동 OpenAPI JSON을 만들지 않는다.

- IncidentSummary, IncidentDetail, IncidentEnvelope, IncidentId, IncidentListResponse.
- IncidentContext의 llm/fluent_bit 모두 필수.
- LLMContext.messages 최소 1개, tools 선택.
- system/developer/user/assistant/tool 역할별 ChatMessage union, text content의 문자열 또는 text part 배열.
- assistant는 유효한 content, 비어 있지 않은 tool_calls, 비어 있지 않은 refusal 중 최소 하나 필요. content 누락/null 허용 조건 보존.
- function arguments는 원본대로 문자열. 명세에 없는 JSON parse 성공 조건이나 메시지 상호 참조 제약을 추가하지 않는다.
- Fluent Bit 레코드 date 필수 및 임의 추가 필드 보존.
- pr_generated와 pr_link의 조건 관계를 요청 검증과 생성된 OpenAPI 양쪽에 반영한다. refine만 넣고 생성 문서가 조건을 잃지 않게 검사한다.
- request/response의 date-time과 URI 형식, required/nullable 구분, 허용 추가 속성을 원본과 비교한다.
- pageStats는 기존 스키마 재사용. incidents query에는 repository 전용 filter_active를 넣지 않는다.
- body의 incident_id/repo_id 등은 대상으로 사용하지 않는다. 추가 속성 처리 방식은 원본을 유지하며, ID를 덮어쓰기 대상 선택에 쓰지 않는 테스트를 둔다.

## 9. 파일 단위 작업 순서

1. 기준선 재확인: 워크트리 변경 보존, 타입 불일치 최소 수정과 회귀 테스트를 분리.
2. `migrations/0004_create_incidents.sql`: incidents 테이블/제약/인덱스.
3. 후속 migration: 실행 예약·매핑·토큰·OIDC jti. 삭제 중 활성 슬롯 보존을 먼저 설계하고 테스트.
4. `src/incidents/schema.ts`, `src/incidents/store.ts`: 입력 스키마, 읽기·삭제·내부 생성·원자적 전체 교체.
5. `src/endpoints/incidents.ts`: 목록·상세·삭제 Chanfana 클래스.
6. `src/incidents/engineRuns.ts`: 내부 예약·활성화·신뢰된 run 연결·완료/폐기 함수. HTTP 예약 API 및 dispatcher 금지.
7. `src/incidents/engineAuth.ts`, `src/endpoints/engineToken.ts`: OIDC 발급과 자체 engine Bearer 검증. 구현 규모에 따라 token store만 별도 파일로 분리 가능.
8. 사건 POST 클래스와 정확한 method/path 인증 분리, `src/index.ts`에 5개 신규 operation 등록 및 보안 스키마 추가.
9. `tests/incidents.test.ts`, `tests/engineTokens.test.ts`: 아래 수용 기준 검증. 필요할 때만 테스트 helper 추가; 기존 테스트 전체 재작성 금지.
10. `bun test`, `bun run typecheck`, Chanfana 명세 검증, 로컬 D1 및 dry-run 검증 후 결과·미구현 운영 연결점을 보고.

긴 설계 설명은 이 문서에 유지하고 코드 주석은 필요한 제약 설명만 짧게 작성한다. README, public, GitHub auth 구현, 기존 오류 처리, 배포 파이프라인을 일괄 정리하지 않는다.

## 10. 검증 및 수용 기준

### DB·API

- 기존 DB에 추가 migration 적용 가능; 이전 데이터 유지; SQL FK/PR/JSON/messages 제약 검증.
- 목록의 빈 결과, 페이지 경계, per_page 30/31, 최신순 정렬, 동률 ID 정렬, 다른 timezone 검증.
- 목록은 summary만, 상세는 context 포함; 임의 Fluent Bit 필드와 LLM 컨텍스트 왕복 보존.
- 사용자 인증 실패, 권한 회수, 타 repository 사건 접근 차단.
- admin/maintain 삭제 허용, read/push-only 삭제 거부, 비활성 조회·삭제 허용.
- repository 삭제 cascade와 사건 삭제 후 token 사용 거부.
- 기존 repository 목록·암호화·권한 테스트 유지.

### engine·OIDC

- 유효 서명과 정확한 사전 실행 연결이 있는 OIDC만 발급 가능.
- 잘못된 서명/issuer/audience/exp/jti, replay, 다른 repo/workflow/run/attempt 거부.
- TTL 1/21900 허용, 0/21901/소수/누락 거부.
- DB에 토큰 평문 없음; 응답 no-store; 교체 후 이전 토큰 실패.
- 사용자 쿠키만 있는 사건 POST와 OIDC 토큰을 직접 사용한 사건 POST 모두 거부.
- engine token은 연결된 사건만 덮어씀; 임의 body ID로 대상 변경 불가; 다른 repository 경로 거부.
- body 없는 201, 올바른 Location; created_at/incident_id 보존; 신규 사건 및 재예약 없음.
- 토큰 폐기/만료/연결 삭제 후 POST 실패; 동시 발급과 재사용 경합에서도 현재 정상 토큰 유지.
- repository별 한 활성 실행, 다른 repository 독립 진행. 삭제/만료만으로 다음 실행이 시작되지 않음.

### 생성 명세·실행 환경

- Chanfana로 생성한 문서에 정확한 5개 신규 operation과 응답·보안·입력 제약 확인.
- 기존 사용자 경로는 cookieAuth, 발급은 GitHubActionsOIDC, 사건 POST는 RepositoryBearer로 분리.
- 원본 예시 및 조건 경계값을 요청/응답 스키마 테스트에 사용하고, generated OpenAPI를 독립 validator로 점검한다. validator는 개발 전용이며 Worker import 금지.
- Bun SQLite adapter 테스트는 D1 실환경 검증과 구분한다. FK를 켜고, batch/경합 테스트는 로컬 Workers/D1에서 수행한다.
- GitHub 네트워크는 합성 응답, OIDC는 테스트 키/JWKS로 검증한다. 실제 GitHub Actions 검증 완료로 표현하지 않는다.
- Vitest/Swagger UI 자산을 추가하지 않고 테스트 파일이 배포 번들에 포함되지 않음을 확인한다.
- 원격 migration/배포는 수행하지 않는다.

## 11. 완료 보고 규칙

구현 완료 후에는 incidents API와 engine 인증·매핑의 로컬 검증 결과를 보고한다. 실제 오류 탐지, Actions 자동 실행, 운영 run 연결, 완료 이벤트 처리는 후속이라는 사실을 명시한다. 신뢰된 실행 연결 없이는 발급할 수 없다는 점을 테스트 우회 인증이나 임시 사용자 POST로 숨기지 않는다.

위 내용은 승인된 구현 기준이다. 현재 구현과 검증 결과는 `../INCIDENTS_IMPLEMENTATION.md`에 기록했다. §3의 타입 오류와 Swagger 설명은 계획 작성 당시 기준선이며, 타입 오류는 사용자의 수정 및 후속 승인에 따른 최소 D1 변환 수정으로 해소했다.
