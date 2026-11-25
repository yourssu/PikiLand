# Incidents 구현 상태

2026-11-25 기준. 원격 배포 및 원격 D1 migration은 수행하지 않았다.

## 구현 범위

- 사용자 쿠키 인증으로 사건 목록·상세 조회, admin/maintain 권한으로 삭제.
- engine Bearer로 연결된 사건 전체 덮어쓰기. 요청에 사건 ID 추가 없음, 본문 없는 201 및 Location 유지.
- GitHub OIDC로 사전 연결된 실행의 engine 토큰 발급·교체. 유효 시간 1~21900초, SHA-256 hash 저장, OIDC jti 재사용 방지.
- 서버 내부 사건 생성·실행 예약·활성화·신뢰된 GitHub 실행 연결·완료 처리.
- 비활성 repository에서도 조회·삭제 및 기존 engine 토큰의 결과 반영 허용. 신규 예약·토큰 발급 거부.
- Chanfana 클래스에서 입력 검증 및 OpenAPI 자동 생성. 기존 GitHub 로그인, README, public, Swagger 노출 설정은 변경하지 않았다.

## DB 및 API

추가 migration은 `0004_create_incidents.sql`, `0005_create_incident_engine_tokens.sql`이다. 기존 migration은 변경하지 않았다.

| 경로 | 메서드 | 인증 |
| --- | --- | --- |
| `/api/repositories/{repo_id}/incidents` | GET | 사용자 쿠키 |
| `/api/repositories/{repo_id}/incidents/{incident_id}` | GET | 사용자 쿠키 |
| `/api/repositories/{repo_id}/incidents/{incident_id}` | DELETE | 사용자 쿠키 + admin/maintain |
| `/api/repositories/{repo_id}/incidents` | POST | 자체 engine 토큰 |
| `/api/repositories/{repo_id}/tokens/engine` | POST | GitHub Actions OIDC |

목록은 발생 시각 내림차순, 동률은 incident_id 내림차순이다. 기본 page=1, per_page=10이며 최대 30이다. 날짜는 UTC ISO 8601 밀리초 표현으로 정규화한다.

사건 삭제는 연결 토큰을 제거하지만 활성 실행의 슬롯은 유지한다. 신뢰된 완료 확인 후에만 다음 예약을 활성화할 수 있다. 토큰 만료나 사건 POST 성공만으로 실제 Actions job 완료를 판단하지 않는다.

## 필요한 운영 설정

| 이름 | 값 |
| --- | --- |
| `OIDC_AUDIENCE` | runner가 OIDC 요청 시 지정하는 정확한 audience |
| `OIDC_WORKFLOWS` | 허용하는 정확한 workflow_ref 문자열의 JSON 배열 |

workflow_ref 형식은 `owner/repository/.github/workflows/file.yml@refs/heads/branch`이다. audience나 allowlist가 없거나 형식이 잘못되면 발급하지 않는다. 실제 운영 값은 이번 작업에서 설정하지 않았다.

OIDC는 Hono의 `verifyWithJwks`로 고정 GitHub JWKS와 RS256 서명을 검증한다. 이후 repository 식별자, workflow/ref, workflow_dispatch 이벤트, 서버에 연결된 run_id/run_attempt를 확인한다. 사용자 정의 sub 형식을 임의로 고정하지 않고 필수 비어 있지 않은 값인지 검사하며, 실행 권한은 서명된 repository/workflow/run claims와 서버 매핑의 일치로 제한한다.

## 후속 dispatcher가 사용할 내부 함수

`src/incidents/engineRuns.ts`에 다음 함수를 제공한다. 공개 HTTP 관리 API는 없다.

1. `createIncidentAndReserve`: 오류 로그로 사건과 예약을 원자적으로 생성. 초기 LLM context에는 해당 로그 JSON을 user 메시지로 보관.
2. `activateRun`: 같은 repository의 FIFO 선두 예약을 활성화. 이미 활성 실행이 있으면 거부.
3. `bindRun`: 신뢰된 dispatcher가 확인한 GitHub run_id/run_attempt/workflow_ref를 활성 예약에 연결. 최초 한 번만 연결 가능.
4. `completeRun`: 신뢰된 실행 완료 확인 후 해당 예약의 토큰을 폐기하고 슬롯을 해제. 사건이 먼저 삭제되어도 호출 가능.

실제 로그 분석기, GitHub Actions dispatch, 실행 완료 webhook/poller, 자동 큐 소비기는 구현하지 않았다. 따라서 운영 dispatcher가 실행 연결을 기록하기 전에는 OIDC 서명이 유효해도 토큰을 발급받을 수 없다. runner 시작과 bindRun 사이의 운영 연결·재시도는 후속 dispatcher 통합에서 처리해야 한다.

OIDC 재사용 기록은 repository 삭제와 독립적으로 유지한다. 만료 기록의 정기 정리는 이번에 추가하지 않았다.

## 검증

- `bun test`: 기존 10개를 포함한 20개 테스트 통과. 합성 GitHub 응답, 실제 RSA 서명/JWKS 검증, SQLite adapter를 사용한다.
- `bun run typecheck`: 통과.
- `bun run test:d1`: Wrangler와 같은 버전의 Miniflare/workerd D1으로 migration, FK, batch rollback, FIFO 동시 활성화, 토큰 replay, POST와 토큰 교체·삭제·완료 경합 검증. Hono 요청과 인증 로직은 Node에서 실행하고 실제 로컬 D1 binding에 연결한다.
- Chanfana가 생성한 OpenAPI를 독립 Swagger Parser로 검증하고 보안 스키마, 201의 빈 본문, Location, TTL·페이지 제한을 확인한다.
- Wrangler deploy dry-run 통과. 테스트 fixture, Bun test, Miniflare, Swagger Parser는 Worker 번들에 포함되지 않는다. 새 런타임 의존성은 없다.
- 실제 GitHub OAuth/Actions 통합, 운영 환경의 동시성 및 원격 배포 검증은 수행하지 않았다.

로컬 D1에서 is_active가 INTEGER 0/1로 반환되는 것을 확인하여 기존 repository의 조회 타입과 boolean 변환만 최소 수정했다. DB 선언과 API의 boolean 계약은 유지했다.

## 참고

- [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc)
- [Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

API·DB의 업무 계약은 제공된 원본 파일과 대화상 확정 사항을 기준으로 한다. 위 공식 문서는 OIDC와 D1 동작 확인용이다.
