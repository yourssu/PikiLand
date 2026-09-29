# Canary / Blue-Green 배포와 롤백

> 관련 문서: [FIX_SCOPE_RESEARCH.md](../FIX_SCOPE_RESEARCH.md)

## 1. 이게 뭔가

새 버전을 배포할 때 전체 트래픽을 한 번에 새 버전으로 옮기면, 새 버전에 문제가 있을 경우 모든 사용자가 동시에 영향을 받는다. Canary와 Blue-Green은 이 위험을 줄이기 위해 트래픽을 옮기는 방식을 다르게 설계한 두 가지 배포 전략이다.

**Blue-Green**: 완전히 똑같은 환경 두 개(Blue, Green)를 준비해두고, 한쪽(Blue)이 지금 실제 트래픽을 받고 있는 동안 다른 쪽(Green)에 새 버전을 배포해서 충분히 확인한다. 확인이 끝나면 트래픽을 한 번에 Green으로 전환한다. 문제가 생기면 트래픽을 다시 Blue로 돌리기만 하면 되므로 롤백이 즉각적이다.

**Canary**: 새 버전으로 트래픽을 한 번에 다 옮기지 않고, 아주 적은 비율(예: 5%)만 새 버전으로 보내면서 지표를 관찰하고, 문제가 없으면 비율을 점점 늘려간다(5% → 25% → 50% → 100%). 문제가 생기면 새 버전으로 가는 비율을 다시 0으로 낮춰서 롤백한다.

두 방식의 공통점은 "새 버전에 문제가 있을 수 있다는 가정 아래, 실패의 영향 범위(blast radius)를 미리 좁혀둔다"는 것이다.

## 2. 왜 필요한가

점진적 배포가 필요한 이유는 결국 "완벽하게 테스트했다고 믿었던 배포도 실제 프로덕션 트래픽에서만 드러나는 문제가 있다"는 경험 때문이다. Blue-Green은 새 버전이 잘못됐을 때 트래픽 전환을 되돌리는 것만으로 몇 초 안에 이전 상태로 복구할 수 있다는 점이 장점으로 꼽힌다. Canary는 반대로 처음부터 트래픽을 다 옮기지 않기 때문에, 문제가 있어도 극히 일부 사용자만 영향을 받은 채로 자동 분석이 실패를 잡아낸다.

이 둘을 구분해서 쓰는 이유도 명확하다. Blue-Green은 즉각적인 전체 롤백이 중요할 때 유리하고, Canary는 배포를 자주 하면서 사용자 영향을 최소화하고 싶을 때 유리하다. 둘 다 없이 배포하면, 새 버전의 결함이 그대로 전체 트래픽에 노출된 다음에야 사람이 알아차리고 수동으로 되돌리는 수밖에 없다. 그 사이의 시간이 곧 장애 지속 시간이다.

## 3. 어떻게 동작하는가

**Blue-Green (Kubernetes)**: 두 개의 ReplicaSet(Blue용, Green용)을 동시에 띄워두고, Service의 selector를 어느 ReplicaSet으로 향하게 할지 바꾸는 방식으로 트래픽을 전환한다. 전환은 selector 값 하나를 바꾸는 것이므로 매우 빠르다.

**Canary (Kubernetes)**: 단순한 selector 전환으로는 트래픽을 퍼센트 단위로 나눌 수 없기 때문에, ingress controller나 서비스 메시로 가중치 기반 트래픽 분배가 필요하다. 실무에서 가장 많이 쓰이는 두 도구가 Argo Rollouts와 Flagger다. 둘 다 표준 Deployment 오브젝트 대신 점진적 트래픽 전환을 이해하는 별도 리소스(Rollout)를 쓴다.

**자동 분석과 자동 롤백**: Argo Rollouts는 `AnalysisTemplate`이라는 리소스에 "어떤 지표를 봐서 성공/실패를 판단할지"를 정의해둔다. 예를 들어 5xx 에러율이나 응답 지연 지표를 canary 배포 중에 계속 조회하다가, 기준을 벗어나면 분석이 실패한 것으로 처리한다. 분석이 실패하면 Rollout은 canary 쪽 트래픽 비중을 자동으로 0으로 되돌리고, 배포를 "Degraded" 상태로 표시한다. 즉 사람이 알아차리기 전에 지표만으로 자동 롤백이 일어난다.

## 4. PikiLand v2 적용

인프라 쓰기 권한을 여는 v2 시나리오에서, PikiLand가 만든 패치가 실제로 배포에 반영된 뒤에도 안전망이 필요하다. 지금 Repository Agent Harness는 애플리케이션 코드에 대해서만 테스트·E2E·회귀 검증을 제공하는데, 이 검증은 배포 전 단계에서 끝난다. 배포 후에 실제 트래픽에서 문제가 드러나는 경우를 잡는 장치가 없다.

이 개념은 Candidate Ranker와 PR Publisher 이후 단계에 적용할 수 있다.

1. PikiLand가 만든 패치가 인프라 변경을 포함하고 병합·배포되면, 배포 파이프라인이 Argo Rollouts나 Flagger 같은 progressive delivery 컨트롤러를 통해 canary 방식으로 트래픽을 점진적으로 옮긴다.
2. 원래 Incident의 증상(예: 특정 endpoint의 에러율, 응답 지연)을 `AnalysisTemplate`의 성공 기준으로 그대로 넣는다. PikiLand가 이미 Incident Store에 이 증상을 기록해두므로, 여기서 재사용할 수 있다.
3. canary 단계에서 같은 증상이 다시 나타나면 자동으로 트래픽 비중이 0으로 돌아가고, PikiLand의 Verification Policy는 이 배포를 최종 `Verified`로 확정하지 않는다. Slack Notifier는 "패치가 배포됐지만 canary 단계에서 원래 증상이 재발해 자동 롤백됐다"고 보고한다.
4. 롤백 자체는 초 단위로 끝나야 하므로, Blue-Green 방식의 즉시 전환도 병행 후보다. 다만 canary는 "일부 트래픽만으로 재발을 조기에 감지한다"는 점에서 자동화된 검증 루프와 더 잘 맞는다.

이 구조가 갖춰져야 FIX_SCOPE_RESEARCH.md의 v2 진입 조건 중 "단계적 롤아웃과 즉시 롤백 경로"가 실제로 채워진다. 이게 없는 상태에서 인프라 변경을 배포하면, 배포 후 문제를 사람이 수동으로 발견하고 되돌리는 수밖에 없다.

## 5. 참고 자료

- [Blue-Green Deployment vs Canary Release (Unleash)](https://www.getunleash.io/blog/blue-green-deployment-vs-canary-release)
- [Blue/green Versus Canary Deployments (Octopus Deploy)](https://octopus.com/devops/software-deployments/blue-green-vs-canary-deployments/)
- [Blue-Green vs Canary vs Rolling Deployments in Kubernetes (CloudOptimo)](https://www.cloudoptimo.com/blog/blue-green-vs-canary-vs-rolling-deployments-in-kubernetes-how-to-choose-the-right-one/)
- [Analysis & Progressive Delivery (Argo Rollouts Docs)](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/)
- [Canary (Argo Rollouts Docs)](https://argo-rollouts.readthedocs.io/en/stable/features/canary/)
- [argoproj/argo-rollouts (GitHub)](https://github.com/argoproj/argo-rollouts)
