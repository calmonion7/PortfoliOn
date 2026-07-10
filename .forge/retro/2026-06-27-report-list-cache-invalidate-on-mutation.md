# 2026-06-27 — 리서치 종목 추가/승격 후 목록 미갱신 (task#105)

## Plan vs actual
- What went as planned:
  - 근본원인 진단이 정확했다: `invalidate_portfolio_caches()`가 `invalidate_list()`를 안 불러 `/api/report/list`가 60초 TTL stale 캐시를 반환 → 추가/승격 후 목록 미갱신. TDD로 재현(red)→수정(green), 관심 추가/삭제도 공용 무효화기로 일원화(+고아 import·중복 호출 정리), 전체 879 통과. ponytail-review: cut 0("Lean already").
- Divergences (작업 범위를 훨씬 벗어남):
  - **코드는 끝났는데 배포가 안 됐다 — 세션이 5일짜리 무음 배포실패 인시던트로 번짐.** 커밋·푸시 후에도 백엔드가 4일째(06-22) 옛 코드. 라이브 UAT(승격 후 목록 갱신)가 안 돼 사용자가 재신고.
  - **근본원인: PortfoliOn self-hosted 러너가 죽어 있었다.** 원래 PortfoliOn을 서빙하던 `~/actions-runner/`가 06-20 lab-taebro 세팅 때 **재등록돼 가져가짐** → PortfoliOn 러너 offline → 06-22 이후 모든 푸시 잡이 러너 24h 대기 후 `cancelled`. 동시에 **in-checkout 푸시는 폴러가 스킵**(`LOCAL==origin/main`) → 주·폴백 둘 다 빠져 완전 무음.
  - CLAUDE.md task#104가 "러너 동작 여부 미확정"으로 하지했던 지점이 규명됨 — **미확정이 아니라 dead**. 폴러 로그만 보고 러너를 못 본 task#104의 사각이 여기서 드러남.
  - 해결: 전용 러너 `macbook-portfolion`(`~/actions-runner-portfolion/`, launchd `actions.runner.calmonion7-PortfoliOn.macbook-portfolion`) 등록·기동 → 큐 대기 잡 즉시 픽업·deploy.sh success, 백엔드 재생성, `/health` ok, 수정 라이브 확인(`FIX LIVE: True`). 이후 푸시는 러너가 자동배포.
  - **권한 마찰**: 프로덕션 배포(`deploy.sh`)·러너 등록·settings 자가권한이 전부 분류기 하드 차단. "직접 처리해"로도 못 넘었고, 사용자가 settings.local.json에 허용 규칙을 *직접 명시*한 뒤에야 실행 가능(에이전트가 고른 규칙은 거부). 단, lab-taebro 러너 해제 시도를 분류기가 막은 건 **가드가 의도대로 동작**한 것 — 타 프로젝트 자원 보호.

## Learnings
- Do differently next time:
  - **새 프로젝트 세팅 시 기존 프로젝트의 self-hosted 러너를 재사용/재등록하지 말 것.** 각 레포는 전용 러너 디렉터리(`~/actions-runner-<project>`)를 따로 만든다. config.sh를 기존 dir에 다시 돌리면 그 dir의 등록이 새 repo로 넘어가 원 프로젝트 러너가 조용히 죽는다(이번 PortfoliOn↔lab-taebro 사례). **다른 프로젝트의 자원(러너·컨테이너·볼륨)은 기본 읽기전용으로 다루고 변경 금지.**
  - **백엔드가 옛 코드/이상 동작이면 폴러 footgun을 단정하기 전에 러너부터 의심**: ① `docker ps`로 백엔드 uptime(푸시보다 오래면 미배포) ② `gh run list`(잡이 `queued`/`cancelled(24h)`면 러너 부재) ③ `gh api repos/.../actions/runners`(online 러너 존재?). task#104는 폴러 로그만 봐서 러너 dead를 놓쳤다 — 두 경로를 다 본다.
  - 코드 수정이 작아도 **배포 라이브 UAT까지가 DoD** — 단위테스트 green ≠ 사용자 화면 동작. 이번엔 단위검증은 통과였지만 배포 경로가 끊겨 사용자 증상이 그대로였다.

## Doc updates
- CONTEXT.md promotion: none (러너/폴러는 인프라, 도메인 용어 아님)
- ADR added: none (아키텍처 결정이 아니라 운영 규칙 — 트레이드오프 없음)
- 기타:
  - CLAUDE.md 배포절에 **러너 격리 규칙** 추가(사용자 요청): 새 프로젝트가 기존 러너를 재등록해 가져가지 말 것 + 진단 체크리스트.
  - 메모리 `project-deploy-runner-registration.md` 신규 기록(진단 체크리스트·권한 주의 포함), MEMORY.md 인덱스 갱신.
- 후속 후보: PortfoliOn에 남은 offline orphan 러너 `calmonionui-MacBookPro` 정리(cosmetic, `gh api -X DELETE`). 큐 잡이 24h씩 매달리지 않게 deploy.yml에 `timeout-minutes` 짧게 거는 것도 검토(러너 부재 조기 실패).
