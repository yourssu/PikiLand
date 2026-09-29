# Terraform Policy-as-Code 게이트

> 관련 문서: [FIX_SCOPE_RESEARCH.md](../FIX_SCOPE_RESEARCH.md)

## 1. 이게 뭔가

Terraform은 인프라를 코드(`.tf` 파일)로 정의하고, 그 코드를 실제 클라우드 자원에 반영하는 도구다. 이 반영 과정은 두 단계로 나뉜다.

- `terraform plan`: 지금 코드가 실제로 적용되면 무엇이 생성·수정·삭제되는지 미리 계산만 한다. 실제 자원은 하나도 바뀌지 않는다.
- `terraform apply`: plan에서 계산한 변경을 실제로 클라우드에 반영한다.

Policy-as-code는 이 plan과 apply 사이에 "이 변경이 우리 규칙을 어기지 않는가"를 자동으로 검사하는 단계를 끼워 넣는 것이다. 검사를 통과하지 못하면 apply 자체가 막힌다. 사람이 매번 plan 결과를 읽고 판단하는 대신, 규칙을 코드로 적어두고 기계가 검사하게 만드는 방식이다.

## 2. 왜 필요한가

코드 리뷰만으로는 인프라 변경의 위험을 다 걸러내지 못한다. plan 결과는 수백 줄짜리 diff로 나올 때가 많고, 사람이 매번 그 안에서 "이 보안 그룹이 0.0.0.0/0을 열어준다"거나 "이 S3 버킷이 public이 된다"는 문제를 눈으로 잡아내는 건 실수하기 쉬운 방식이다. Sentinel과 OPA 같은 policy-as-code 도구가 나온 이유가 바로 이거다. HashiCorp는 Sentinel을 "사용자가 할 수 있는 일을 통제하는 정책을 코드로 정의해서, 허용되지 않은 변경이 배포되기 전에 막는" 프레임워크로 소개한다.

구체적인 위험은 반복되는 패턴이 있다. AWS는 `aws_s3_bucket_public_access_block` 리소스로 버킷의 public access를 막는 걸 기본 권장사항으로 문서화해두고 있는데, 이걸 빠뜨리면 그대로 public 버킷이 생긴다. 리뷰어가 매번 이 설정을 확인하는 대신, 정책으로 "이 설정이 빠진 버킷은 apply되지 않는다"를 강제하면 실수 자체가 구조적으로 불가능해진다. Terraform 공식 문서 역시 policy set을 워크스페이스에 걸어두면 모든 run의 plan이 정책 검사를 통과해야 apply로 넘어간다고 설명한다.

## 3. 어떻게 동작하는가

**Sentinel(HashiCorp)**: Terraform Cloud/Enterprise에 내장된 정책 엔진이다. plan이 끝나면 그 결과를 mock 데이터로 만들어서 Sentinel 정책 코드에 입력으로 넘긴다. 정책이 통과하면 apply로 넘어가고, 실패하면 apply가 막히고 수정이 필요하다는 결과가 남는다. 별도 CI 연동 없이 Terraform Cloud 파이프라인 안에서 바로 동작한다는 게 특징이다.

**OPA(Open Policy Agent)와 Conftest**: OPA는 범용 정책 엔진이고, Rego라는 언어로 정책을 짠다. Terraform과 연결할 때는 `terraform show -json`으로 plan 결과를 JSON으로 뽑아낸 다음, 그 JSON을 OPA나 Conftest에 입력으로 준다. Conftest는 `conftest test --policy <정책폴더> plan.json` 같은 명령으로 plan JSON을 검사하는 CLI 도구다. plan JSON 안의 `resource_changes` 배열을 보면 어떤 리소스가 생성·수정·삭제되는지 다 들어있어서, 정책은 이 배열을 순회하며 "이 필드가 이 값이면 안 된다"를 검사한다. Sentinel과 달리 OPA/Conftest는 특정 벤더에 묶이지 않아서, GitHub Actions 같은 일반 CI 파이프라인에서도 그대로 쓸 수 있다.

두 방식 모두 핵심 구조는 같다. **plan(계획) → 정책 검사(자동) → apply(반영)**. 정책 검사가 반영 전에 있다는 게 중요하다. 반영 후에 검사하면 이미 사고가 난 뒤다.

## 4. PikiLand v2 적용

PikiLand가 인프라 쓰기 권한을 여는 v2 단계에 들어가면, 이 게이트를 Independent Verification Agent 자리에 그대로 끼워 넣을 수 있다.

1. Primary Coding Agent가 인프라 코드(Terraform 등)를 수정하면, Repository Agent Harness 위에서 `terraform plan`을 실행하고 `terraform show -json`으로 plan 결과를 JSON으로 뽑는다.
2. Independent Verification Agent가 이 plan JSON을 OPA/Conftest 정책으로 자동 검사한다. 정책은 저장소마다 다를 수 있으니, PikiLand는 최소 공통 정책 세트(예: public 버킷 금지, 0.0.0.0/0 인바운드 금지, 프로덕션 리소스 삭제 금지)를 기본 제공하고 저장소가 추가 정책을 얹을 수 있게 한다.
3. 정책 위반이 하나라도 있으면 Verification Policy는 이 후보를 `Verified`로 판정하지 않는다. Ralph Loop의 다음 반복으로 돌아가거나, `Verification failed`로 종료한다.
4. 정책을 통과한 plan만 사람이 "Approve and apply" 형태로 승인하는 PR 단계로 넘어간다. apply 자체를 에이전트가 무인으로 실행하지는 않는다.

이 방식이면 인프라 diff를 사람이 매번 눈으로 읽지 않아도, 최소한의 안전 규칙은 기계가 먼저 걸러준다. FIX_SCOPE_RESEARCH.md의 v2 진입 조건 중 "policy-as-code 수준의 자동 검사"가 바로 이 구조를 가리킨다.

## 5. 참고 자료

- [What is Policy as Code with Sentinel? (HashiCorp Developer)](https://developer.hashicorp.com/sentinel/tutorials/get-started/policy-as-code)
- [Policy as Code (Sentinel Docs, HashiCorp Developer)](https://developer.hashicorp.com/sentinel/docs/concepts/policy-as-code)
- [Terraform | Open Policy Agent](https://www.openpolicyagent.org/docs/terraform)
- [How to Use Conftest with Terraform for Policy Testing](https://oneuptime.com/blog/post/2026-02-23-how-to-use-conftest-with-terraform-for-policy-testing/view)
- [Enforcing Policy as Code in Terraform with Sentinel & OPA (Spacelift)](https://spacelift.io/blog/terraform-policy-as-code)
- [aws_s3_bucket_public_access_block (Terraform Registry)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block)
