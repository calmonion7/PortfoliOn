# 2026-06-22 — 대시보드 500 NaN/inf 직렬화 fix + 배포 누락 발견 (task#104)

## Plan vs actual
- What went as planned:
  - 근본을 `_portfolio_totals` NaN→직렬화 500(CONCERNS §3)으로 확정. Playwright/fetch 직접 프로브로 cold dashboard 6/6 500 재현, unit test로 `ValueError: Out of range float values are not JSON compliant` red 재현. fix: `_usdkrw_rate` isfinite 가드 + `_build_all` 반환 sanitize. 878 passed.
  - 배포 후 직접 검증: cold dashboard 500→200, holdings=5 채워짐, totals finite, NaN 0.
- Divergences (큼):
  - **라이브 500 원인은 미확정 — 내 "배포 누락" 단정은 과잉결론(정정)**: fix 푸시 후에도 라이브 500이 지속돼 *폴러 로그만 보고* "이 세션 백엔드 #95~104 전부 미배포"로 단정했으나, 폴러 로그는 **GitHub Actions 러너(주 배포)를 안 찍는다** — 러너가 push마다 배포했다면 미배포 단정은 틀림. 사용자 반박("원래 배포 됐어")이 옳을 수 있고, **사용자 가설(도커 재기동 시 certbot 등 일부 미기동→스택 불완전 기동)이 더 그럴듯**하다: `docker ps` uptime이 제각각(postgres 4h·certbot 2h·backend/nginx 1h)이라 재기동 churn이 실재. `bash deploy.sh`가 500→200으로 고친 건 *새 코드 배포*가 아니라 **불건전 backend 컨테이너의 깨끗한 재생성**일 수도 있다. 정확한 라이브 원인은 (배포 당시 traceback 부재로) 미확정.
  - **task#102 진단도 추정이었음**: #102는 "콜드 풀 경합 per-card throw", #104는 "totals NaN 직렬화"로 봤지만, 라이브 원인을 traceback으로 못 박지 못한 채 둘 다 추정. 단 **NaN 직렬화 500은 unit test로 확정된 *실재* 버그**(FX nan→totals nan→`ValueError`)라 task#104 fix는 원인 불문 유효한 hardening.

## Learnings
- Do differently next time:
  - **라이브 실패 원인을 *데이터 없이 단정하지 말 것* (이번 최대 실수)**: 폴러 로그만 보고 "in-checkout push는 자동배포 안 됨 → 전부 미배포"로 단정해 CLAUDE.md·회고에 *검증 안 된 주장*을 커밋했다(사용자가 "원래 배포 됐어"로 반박, 정정함). 검증된 사실은 ① 폴러는 origin>local일 때만 `deploy.sh` 실행 ② in-checkout push는 LOCAL==origin이라 폴러 미발동 — **여기까지만 사실**이고, "그래서 배포 안 됨"은 **러너(주 경로)를 무시한 비약**. 러너 동작/배포 메커니즘 미확인 상태에서 root-cause를 docs에 박지 말 것.
  - **라이브 디버그는 docker ps(uptime)·컨테이너 health부터**: backend/nginx 1h·certbot 2h·postgres 4h로 uptime이 제각각 = 재기동 churn 실재(사용자 certbot 가설 뒷받침). 라이브 500은 NaN 코드버그일 수도, 재기동 불건전 상태일 수도 — 인프라 상태(컨테이너 uptime/health)를 코드 재진단과 *함께* 봐야 했다.
  - **직접 재현(Playwright/fetch 프로브 + unit red)이 결정타였던 건 유효**: NaN 직렬화 500은 unit test로 *실재* 확정(`Out of range float ... not JSON compliant`). task#104 fix(isfinite+sanitize)는 그 실재 버그의 유효한 hardening — 다만 *라이브 500의 원인이라고 단정*하진 못한다(traceback 부재).
  - FX가 왜 nan이었나 + 러너 배포 실제 동작 여부 = 미규명(후속 확인 후보).

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (배포 footgun은 새 결정이 아니라 운영 현실 — ADR 부적합, CLAUDE.md 가토가 적소)
- **CLAUDE.md**: ① 대시보드 가토에 "totals NaN 직렬화 500, isfinite+sanitize"(task#104 S3) ② 배포 절 — 처음엔 "in-checkout push는 배포 안 됨"으로 단정 추가했다가, **사용자 반박+컨테이너 uptime 증거로 과잉결론 판명 → 검증된 사실(폴러는 origin>local만 발동·러너가 주 경로·인프라 재기동 의심·`bash deploy.sh` 수동 복구)로 정정**하고 단정 철회. (잘못 커밋한 docs를 같은 세션에 바로 정정.)
