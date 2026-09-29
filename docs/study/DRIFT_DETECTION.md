# Drift Detection

> 관련 문서: [FIX_SCOPE_RESEARCH.md](../FIX_SCOPE_RESEARCH.md)

## 1. 이게 뭔가

Terraform 같은 IaC(Infrastructure as Code) 도구는 "코드에 뭐라고 적혀 있는지"와 "실제 클라우드에 뭐가 떠 있는지"를 별도의 상태 파일(state file)로 추적한다. Drift(드리프트)는 이 둘이 어긋난 상태를 말한다. 코드에는 A라고 적혀 있는데, 실제 자원은 B로 바뀌어 있는 상황이다.

가장 흔한 원인은 누군가 AWS 콘솔이나 `kubectl edit` 같은 명령으로 IaC를 거치지 않고 직접 자원을 고치는 것이다. 예를 들어 트래픽이 급증했을 때 엔지니어가 Auto Scaling Group의 `max_size`를 콘솔에서 바로 올려버리고, Terraform 코드에는 반영하지 않는 경우다. 이 순간부터 코드와 실제 인프라는 서로 다른 이야기를 하게 된다.

## 2. 왜 필요한가

드리프트를 방치하면 코드가 더 이상 진실을 말해주지 않는다. Spacelift의 조사에 따르면 대규모 IaC 배포의 90%에서 드리프트가 발생하고, 그중 절반 가까이는 아무도 눈치채지 못한 채 넘어간다. 드리프트가 위험한 이유는 단순히 "기록이 틀렸다"가 아니라, 다음에 누군가 그 코드를 기반으로 배포를 하면 IaC가 드리프트를 모른 채로 실제 자원을 덮어써버릴 수 있다는 점이다. 콘솔에서 임시로 늘려놓은 `max_size`가 다음 `terraform apply`에서 원래 코드값으로 되돌아가면, 정작 트래픽이 몰리는 순간에 스케일이 다시 줄어드는 식이다.

더 근본적인 문제는 이게 누적된다는 점이다. 팀이 드리프트를 발견해도 당장 급하면 "일단 그대로 두자"고 넘어가는 경우가 많고, 그 다음 엔지니어는 실제 드리프트된 상태를 기준으로 작업을 계속한다. 몇 달이 지나면 IaC 코드는 더 이상 실제 인프라의 문서가 아니라, 과거의 어느 시점을 가리키는 기록으로만 남는다.

## 3. 어떻게 동작하는가

**`terraform plan`으로 드리프트 확인**: `terraform plan`을 실행하면 Terraform은 먼저 실제 클라우드 상태를 다시 읽어서(refresh) state file을 최신화하고, 그다음 코드에 적힌 desired state와 비교한다. 이 비교에서 나오는 차이가 곧 드리프트다. 변경을 실제로 반영하지 않고 드리프트만 확인하고 싶으면 `terraform plan -refresh-only`를 쓴다. Terraform Cloud는 워크스페이스에 drift detection을 켜두면 이 과정을 스케줄에 따라 자동으로 돌려준다.

**한계**: `terraform plan`은 "state file에 있는 리소스가 실제와 달라졌는지"만 잡아낸다. 애초에 state file에 등록조차 안 된 리소스, 즉 누군가 콘솔에서 새로 만들었지만 Terraform이 전혀 모르는 리소스는 plan으로 못 잡는다. 이런 "관리되지 않는 리소스"까지 찾아내려면 `driftctl` 같은 별도 도구가 필요하다. driftctl은 클라우드 API를 직접 조회해서 Terraform state와 실제 인프라 전체를 비교하고, state에 없는 리소스까지 드러낸다. 다만 driftctl은 현재 유지보수 모드로 들어가 있어서, 신규 도입 시에는 대안(예: 클라우드 벤더의 Config Rule, Firefly, ControlMonkey 같은 상용 도구)도 함께 검토하는 게 맞다.

## 4. PikiLand v2 적용

드리프트 문제는 PikiLand가 인프라 쓰기 권한을 열 때 두 방향에서 걸린다.

**입력 쪽 문제**: Context Bundle에 인프라 설정을 읽기 전용으로 넣더라도, 그게 IaC 코드에서 읽은 값이라면 실제 인프라와 다를 수 있다. Primary Coding Agent가 "코드 기준"으로 원인을 진단했는데 실제 인프라는 드리프트되어 있다면, 진단 자체가 틀린 전제 위에 서게 된다. 그래서 Context Builder가 인프라 설정을 Context Bundle에 넣을 때는 IaC 코드 값이 아니라, 배포 시점에 `terraform plan -refresh-only` 같은 명령으로 얻은 실제 상태를 우선해야 한다.

**출력 쪽 문제**: Primary Coding Agent가 인프라 코드를 고쳤을 때, 그 변경이 이미 드리프트된 상태 위에 적용되면 의도치 않은 결과가 나올 수 있다. 그래서 Independent Verification Agent가 plan을 돌리기 전에, 먼저 해당 워크스페이스에 드리프트가 있는지 확인하는 단계를 넣어야 한다. 드리프트가 있으면 Verification Policy는 이 후보를 바로 `Verified`로 판정하지 않고, "드리프트로 인해 검증 불가"라는 별도 사유로 막는다. 이건 FIX_SCOPE_RESEARCH.md에서 다룬 Out-of-code-scope 상태와 비슷한 맥락이다. 코드가 틀린 게 아니라 코드와 실제 상태가 어긋나 있다는 걸 명시적으로 드러내야, 에이전트가 잘못된 전제로 억지 패치를 만드는 걸 막을 수 있다.

## 5. 참고 자료

- [Detecting and Managing Drift with Terraform (HashiCorp)](https://www.hashicorp.com/en/blog/detecting-and-managing-drift-with-terraform)
- [Terraform Cloud Drift Detection: How It Works & Setup (Spacelift)](https://spacelift.io/blog/terraform-cloud-drift-detection)
- [Terraform Drift Detection and Remediation [Guide] (Spacelift)](https://spacelift.io/blog/terraform-drift-detection)
- [Infrastructure Drift Is Inevitable. Losing to It Isn't. (Spacelift, Medium)](https://medium.com/spacelift/infrastructure-drift-is-inevitable-losing-to-it-isnt-32a9ee62dce1)
- [Chaos Under Control: Addressing Cloud Infrastructure Drift (Firefly)](https://www.firefly.ai/blog/chaos-under-control-addressing-cloud-infrastructure-drift)
