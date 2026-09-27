# Fix 범위 결정: 코드베이스 한정 vs 인프라 포함

관련 이슈: #2

## 배경

Primary Coding Agent가 패치를 만들 때, 수정 권한을 어디까지 줄지 아직 결정하지 않았다. 관측 범위(Context Bundle이 읽는 대상)와 픽스 범위(Agent가 실제로 수정하는 대상)를 같게 둘 필요는 없다.

## 질문

1. 관측 범위와 픽스 범위를 분리해야 하는가?
2. 인프라(배포 설정, IaC, 컨테이너 설정 등) 수정까지 Agent에게 허용하면 blast radius와 되돌리기 난이도가 크게 늘어나는데, 이걸 감당할 검증 루프가 지금 있는가?
3. 코드만 고치는 좁은 패치 대신, "이건 배포 설정 문제다" 같은 고차원적 원인 진단을 Agent가 떠올리게 하려면 Context Bundle에 무엇이 더 필요한가?

## 현재 방향 (논의 결과, 확정 아님)

- **픽스 범위는 코드베이스로 한정한다.** 인프라 변경은 검증하기 어렵고 되돌리기 어려워서, PR 리뷰 게이트만으로는 안전을 보장하기 힘들다.
- **관측 범위는 인프라 설정, 과거 유사 인시던트, 아키텍처 문서까지 읽기 전용으로 넓힌다.** 그래야 근본 원인이 코드가 아니라 인프라나 설계에 있을 때 Agent가 이를 인지하고, 코드 수정이 아니라 별도 이슈 제안 등의 형태로 보고할 수 있다.
- **인프라 수정 권한 자체는 다음 단계로 미룬다.** Repository Agent Harness가 인프라 회귀까지 안전하게 검증할 수 있다는 확신이 생긴 다음에 검토한다.

## 리서치 및 결론

### 업계 사례: 자율 코딩 에이전트는 실제로 어디까지 쓰기 권한을 주는가

주요 제품들을 비교하면 하나의 공통된 경계선이 보인다. 작업용 워크스페이스 안의 코드 쓰기는 자유롭게 허용하되, 자동화 정의 자체(CI/CD, 시스템 루트, 시크릿, 네트워크)는 별도 승인 게이트 뒤에 둔다.

GitHub Copilot coding agent는 `.github/workflows/`와 `.github/agents/` 파일을 스스로 수정하지 못하게 막아놓았다. Copilot이 만든 코드는 워크플로가 바로 실행되지 않고, 저장소 쓰기 권한을 가진 사람이 "Approve and run workflows" 버튼을 눌러야 실행된다. 엔터프라이즈 단에서는 셸 명령, 파일 읽기·쓰기, 네트워크 도메인을 별도로 관리형 권한으로 통제한다.

Devin(Cognition)은 Allow/Ask/Deny 세 단계 권한 모델과 샌드박스를 쓴다. 샌드박스 모드에서는 지정된 워크스페이스만 읽기·쓰기가 되고 호스트의 루트 디렉터리는 읽기 전용이거나 아예 숨겨진다. 워크스페이스 밖을 건드려야 하면 에이전트가 `request_scope` 도구로 사람의 승인을 받아야 하고, 네트워크도 `allowed_domains`에 등록된 도메인으로만 제한된다.

OpenAI Codex의 클라우드 에이전트는 setup 단계와 agent 단계를 분리한다. setup 단계에서만 네트워크에 접속해 의존성을 설치하고, 실제로 에이전트가 코드를 고치는 agent 단계는 기본값이 오프라인이다. 시크릿도 setup 단계에만 노출되고 agent 단계 전에 제거된다. Cursor의 background agent 역시 `sandbox.json`으로 읽기·쓰기 가능한 경로와 네트워크 도메인을 분리하고, 클라우드 메타데이터 엔드포인트(`169.254.169.254`)와 사설 IP 대역은 SSRF 방지를 위해 기본적으로 막아둔다. Google Jules는 작업마다 별도의 격리된 VM을 새로 띄워서, 그 VM 안에서는 자유롭게 빌드·테스트를 돌리지만 실제 저장소에는 PR로만 반영된다.

결론적으로 지금 업계에서 검증된 패턴은 "코드베이스 안에서는 넓게, 그 바깥(자동화 정의·시크릿·네트워크·시스템)은 좁게"이다. 인프라 코드(IaC, k8s manifest, 배포 설정)를 이 경계의 어느 쪽에 둘지는 제품마다 명시적으로 정하지 않았지만, 대부분 자동화 정의에 준하는 취급을 받는다는 점에서 지금 PikiLand가 코드베이스로 픽스 범위를 한정하려는 방향은 업계 관행과 일치한다.

### 인프라 자동 수정의 리스크에 대한 근거

인프라 변경이 코드 변경보다 위험한 이유는 추상적인 우려가 아니라 이미 정립된 실무 관행으로 뒷받침된다. Terraform Cloud/Enterprise는 plan과 apply 사이에 Sentinel이나 OPA 같은 policy-as-code 게이트를 반드시 끼워 넣는다. plan 결과가 정책을 위반하면 apply 전에 막힌다. 이 구조가 필요한 이유는 명확하다. 저장소가 한 사람의 노트북 수준을 넘어서면 "리뷰가 잡아줄 것"이라는 기대는 더 이상 통제 수단이 되지 못하고, 퍼블릭 S3 버킷이나 잘못된 리전의 오버사이즈 인스턴스 같은 실수가 그대로 병합된다. 그래서 policy-as-code는 리뷰 시점의 희망을 파이프라인 단계의 강제 게이트로 바꾸는 장치로 자리잡았다.

두 번째 근거는 drift detection이다. CI/CD, 내부 자동화 스크립트, SaaS 통합처럼 IaC 바깥에서 인프라를 직접 바꾸는 경로가 늘어나면, IaC가 모르는 상태가 쌓인다. 실제로 보고되는 사고 패턴은 테스트용으로 넓혀놓은 보안 그룹 규칙이 영구히 열려 있거나, 임시로 public으로 바꾼 S3 버킷이 그대로 방치되는 식이다. 다음 배포에서 이 드리프트를 IaC가 인지하지 못한 채 덮어쓰면 예상 못한 장애로 이어진다. 자율 에이전트가 IaC 파일을 직접 고치는 행위는 바로 이 "IaC 밖에서 인프라를 바꾸는 자동화"의 한 형태다.

세 번째 근거는 되돌리기 난이도의 구조적 차이다. canary·blue-green·feature flag 같은 점진적 배포 전략이 널리 쓰이는 이유는, 위험을 소수 트래픽이나 좁은 구간으로 한정하고 롤백을 "라우팅 전환"이나 "플래그 끄기" 수준으로 단순화하기 때문이다. blue-green의 롤백은 초 단위 라우팅 변경이지만, 인프라를 직접 고치는 변경은 그런 완충 구간이 없어서 실패하면 전체에 곧바로 영향이 간다. 지금 Repository Agent Harness는 애플리케이션 코드에 대해서만 테스트·E2E·회귀 검증을 제공하고, 인프라 변경에 대해 이런 단계적 검증이나 즉시 롤백 경로를 제공하지 않는다. 이 격차가 좁혀지기 전에는 인프라 쓰기 권한을 열어줄 근거가 없다.

네 번째 근거는 AI 기반 운영 자동화 업계 자체의 합의다. read-only remediation workflow라는 패턴은 에이전트가 조사와 제안까지만 하고 실제 조치는 사람이 실행하도록 분리한다. 실무에서는 이를 3단계로 나눈다. "제안만 함", "에이전트가 준비하고 사람이 승인", "정책으로 좁게 묶인 범위 안에서 자율 실행"이다. 권한 회수, 리소스 삭제, 프로덕션 정책 변경처럼 영향이 큰 조치는 에이전트의 판단 경로와 롤백 동작이 검증되기 전까지 승인 게이트 뒤에 두라는 것이 공통된 권고다. 인프라 변경은 정의상 이 "영향이 큰 조치" 범주에 들어간다.

### 근본 원인 진단을 유도하는 컨텍스트 설계

좁은 코드 패치 대신 근본 원인을 짚게 만드는 문제는, 권한 문제가 아니라 컨텍스트 설계 문제로 다뤄야 한다는 근거가 있다. Google SRE Book은 포스트모템에서 5 Whys 같은 기법으로 기여 요인을 추적하되, 비난하지 않는 문화가 전제되어야 한다고 강조한다. 비난이 들어가면 엔지니어가 세부 사실을 숨기게 되어 분석에 필요한 신호 자체가 사라지기 때문이다. 다만 5 Whys는 원인이 선형적일 때 잘 맞고, 여러 원인이 동시에 겹치는 분산 시스템에서는 fault tree 같은 병렬 원인 표현이 보완으로 필요하다는 한계도 같이 지적된다.

이 통찰을 에이전트 컨텍스트 설계에 옮기면, 과거 인시던트를 "증상-근본원인-해결책" 삼중 구조로 정리해 저장해두고, 새 인시던트가 들어오면 유사한 과거 사례를 검색해서 함께 제공하는 방식이 실제로 연구되고 있다. 관련 연구는 이 구조가 없으면 에이전트가 "의도된 동작을 설명하는 문서"만 참고하게 되어, 실제 실패 이력과는 다른 방향으로 진단하는 source mismatch가 생긴다고 지적한다. 클라우드 인시던트 분석에 특화된 접근에서는 아키텍처 다이어그램, 로그·메트릭, 지식베이스를 함께 묶어서 가설을 세우고, 역할이 나뉜 여러 서브에이전트가 관측·검증을 각각 맡아 감독자가 종합하는 구조도 쓰인다.

PikiLand에 적용하면 세 가지가 필요하다. 첫째, Context Bundle에 인프라 설정과 배포 이력을 읽기 전용으로 포함시켜서, 원인이 코드가 아니라 배포·설정에 있을 가능성을 에이전트가 아예 배제하지 않게 한다. 둘째, 과거 Incident를 증상-원인-해결 구조로 축적해서 유사 사례를 Context Bundle에 함께 실어준다. 셋째, Primary Coding Agent와 Verification Policy에 "코드 수정으로는 해결되지 않고 인프라·설계 변경이 필요하다"는 결과를 정식 출구로 만들어줘야 한다. 지금처럼 Verified/Retry/Unreproducible/Unverifiable만 있으면 에이전트는 억지로 코드 안에서 답을 찾으려 하게 된다.

### 최종 권고안

1. **관측 범위와 픽스 범위는 분리한다.** 업계 전체가 이미 이 경계로 수렴해 있다. 관측 범위(Context Bundle)는 코드·로그·행동·릴리스·인프라 설정(읽기 전용)·과거 인시던트까지 넓히고, 픽스 범위는 애플리케이션 코드와 테스트로 한정한다.
2. **인프라 쓰기 권한은 지금 열지 않는다.** Terraform의 plan/policy 게이트, drift detection, canary/blue-green 롤백처럼 인프라 변경을 안전하게 만드는 장치가 Repository Agent Harness에 아직 없다. 이 장치 없이 에이전트에게 인프라 쓰기를 허용하는 것은 업계가 이미 위험하다고 정리해둔 패턴을 그대로 재현하는 것이다.
3. **고차원적 진단은 권한이 아니라 컨텍스트와 출구로 유도한다.** 인프라·과거 인시던트를 읽기 전용으로 노출하고, Verification Policy에 "코드 범위 밖 문제로 판정"이라는 정식 상태를 추가해서, 에이전트가 억지 패치 대신 정확한 보고를 선택할 수 있게 한다.

**v1 범위**: 픽스 범위 = 애플리케이션 코드·테스트. 관측 범위 = 코드·로그·행동·릴리스·인프라 설정(읽기 전용)·과거 Incident. Verification Policy에 `Out-of-code-scope`(가칭) 상태를 추가해서, 이 경우 PR 대신 이슈 제안이나 Slack 보고로 종료한다.

**v2로 넘어갈 조건**: 아래 세 가지가 갖춰지기 전까지 인프라 쓰기 권한은 열지 않는다.
- 인프라 변경도 Terraform plan처럼 "적용 전에 리뷰 가능한 미리보기"가 나온다.
- canary나 staged rollout, 혹은 즉시 롤백 경로가 인프라 변경에도 적용된다.
- Independent Verification Agent가 인프라 diff에 대해 policy-as-code 수준의 자동 검사(OPA/Conftest 등)를 돌릴 수 있다.

## 적용 방안

### 증상-원인-해결 구조로 과거 Incident 저장하기

지금 Incident Store는 중복 키와 처리 상태만 보관한다(`docs/ARCHITECTURE_AND_DATA_PIPELINE.md` 2장). 여기에 아래 세 필드를 추가해서, Verification Policy가 `Verified`로 종료한 Incident마다 채워 넣는다.

- `symptom`: 사용자에게 보인 증상. 에러 메시지, 실패한 시나리오, 영향받은 endpoint.
- `root_cause`: 실제로 문제를 없앤 원인. Primary Coding Agent의 진단이 아니라 검증을 통과한 패치가 고친 부분을 기준으로 적는다.
- `resolution`: 어떤 파일을 어떻게 바꿔서 해결했는지 요약. PR diff 요약과 같다.

실패하거나 재현하지 못한 Incident는 원인이 확정되지 않았으므로 저장하지 않는다. 잘못된 사례가 쌓이면 다음 검색에서 오히려 잘못된 방향을 유도하기 때문이다.

새 Incident가 들어와서 Context Builder가 Context Bundle을 만드는 시점(데이터 흐름 6단계 `Bundle`)에, `symptom`을 임베딩해서 과거 Incident 중 유사도가 높은 몇 건을 함께 실어준다. PikiLand는 이미 PostgreSQL을 상태 저장과 작업 큐(pg-boss)로 쓰고 있으므로, `pgvector` 확장 하나만 추가하면 새 인프라 없이 구현할 수 있다. Primary Coding Agent는 "이 증상은 과거에 이런 원인과 해결로 끝났다"는 사례를 Context Bundle에서 먼저 보고, 좁은 패치보다 반복되는 근본 패턴을 먼저 의심할 수 있다.

### Out-of-code-scope 상태를 Verification Policy에 추가하기

지금 종료 상태는 `Verified`, `Unreproducible`, `Verification failed`, `Usage exhausted`, `Repository not ready` 다섯 가지다(4장). 여기에 `Out-of-code-scope`를 추가한다.

| 종료 상태 | PR | 결과 |
| --- | :---: | --- |
| Out-of-code-scope | X | 코드 수정으로 해결되지 않는다는 진단과 근거 |

판정 조건은 두 가지를 모두 만족할 때다. 첫째, Primary Coding Agent가 Ralph 반복을 여러 번 거쳐도 코드 변경으로 원래 문제를 재현하거나 해결하지 못한다. 둘째, Independent Verification Agent가 Context Bundle의 인프라 설정(읽기 전용)이나 배포 이력에서 명확한 원인 후보를 별도로 확인한다. 두 조건을 나눠 둔 이유는, Primary Agent 혼자의 판단만으로 이 상태를 확정하면 "코드에서 답을 못 찾았다"와 "진짜 코드 밖 문제다"를 구분할 수 없어서 오탐이 늘어나기 때문이다.

이 상태로 종료되면 PR Publisher 대신 다음 경로를 탄다.

- 새 GitHub Issue를 만들어 진단 내용(어떤 인프라·설정이 원인으로 의심되는지, 근거로 쓴 로그·설정)을 본문에 담는다.
- Slack Notifier는 PR 링크 대신 이 Issue 링크와 진단 요약을 보낸다.

증상-원인-해결 구조와 Out-of-code-scope 상태는 둘 다 v1 범위(코드베이스 한정 픽스) 안에서 바로 구현할 수 있다. 인프라 쓰기 권한(v2)이 열리는 것과는 독립적인 선행 작업이다.

### 참고 자료

- [Enterprise managed permissions for GitHub Copilot agent operations](https://github.blog/changelog/2026-09-09-enterprise-managed-permissions-for-github-copilot-agent-operations/)
- [Why is Copilot now prohibited from modifying files under .github/agents?](https://github.com/orgs/community/discussions/187679)
- [Devin Docs: Sandbox](https://docs.devin.ai/cli/sandbox)
- [OpenAI: Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)
- [OpenAI: Permissions](https://developers.openai.com/codex/permissions)
- [Cursor: Implementing a secure sandbox for local agents](https://cursor.com/blog/agent-sandboxing)
- [Cursor: sandbox.json Reference](https://cursor.com/docs/reference/sandbox)
- [Jules: Google's autonomous AI coding agent](https://blog.google/innovation-and-ai/models-and-research/google-labs/jules/)
- [Policy as Code: Controlling Terraform Auto-Apply with Sentinel](https://medium.com/@anshumiui58/policy-as-code-controlling-terraform-auto-apply-with-sentinel-in-hcp-terraform-65dd2a47ae62)
- [Terraform Policy Enforcement: Sentinel and OPA](https://tingli666.medium.com/terraform-policy-enforcement-a-practical-guide-to-sentinel-and-opa-3407d496bc83)
- [Drift Detection in IaC: Prevent Your Infrastructure from Breaking](https://www.env0.com/blog/drift-detection-in-iac-prevent-your-infrastructure-from-breaking)
- [Infrastructure drift and drift detection explained (Snyk)](https://snyk.io/blog/infrastructure-drift-detection-mitigation/)
- [Blue-green deployment vs canary release (Unleash)](https://www.getunleash.io/blog/blue-green-deployment-vs-canary-release)
- [Blue/green Versus Canary Deployments (Octopus Deploy)](https://octopus.com/devops/software-deployments/blue-green-vs-canary-deployments/)
- [Google SRE Book: Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)
- [What is root cause analysis? Methods, process, and limits (ClickHouse)](https://clickhouse.com/resources/engineering/root-cause-analysis)
- [Leveraging Resolved Incident History for LLM-Assisted Software Bug Diagnosis](https://arxiv.org/html/2607.21911v1)
- [Exploring LLM-based Agents for Root Cause Analysis (Microsoft Research)](https://www.microsoft.com/en-us/research/publication/exploring-llm-based-agents-for-root-cause-analysis/)
- [Least privilege for AI agents: Identity, access, and tool binding (Microsoft Security Blog)](https://www.microsoft.com/en-us/security/blog/2026/07/16/least-privilege-for-ai-agents-identity-access-and-tool-binding/)
- [What Is Read-only remediation workflow?](https://nhimg.org/glossary/read-only-remediation-workflow/)
- [Should organisations keep humans in the loop for AI-driven remediation?](https://nhimg.org/faq/should-organisations-keep-humans-in-the-loop-for-ai-driven-remediation/)
