# 2026-06-06 — task 7 리포트 목록 사이드바 탭 컴팩트 정돈

## Plan vs actual
- What went as planned: 단일 슬라이스(S1) — `.reports-sidebar` 스코프 컴팩트 밑줄 탭(white-space:nowrap+패딩/폰트 축소), 카운트 `(N)`→작고 흐린 `.tab-cnt` span(괄호 제거), 상단 보유/관심/그외(+미생성) 행 + 관심 서브행 함께 적용, 전역 `tokens.css .tab-btn` 불변. **결과물=계획(WHAT·디자인·범위·안전 모두 일치)**, 빌드 통과·main 배포(908f3092)·라이브 번들 해시 일치·사용자 UAT yes(한 줄로 잘 나옴).
- Divergences:
  - **실행 환경 발산(핵심)**: 메인 체크아웃에 launchd `com.portfolion.auto-deploy-poll`(120s)이 돌며 `origin/main`이 로컬보다 앞서면 `git reset --hard origin/main`+`deploy.sh` 실행. 첫 편집 5곳이 21:32 reset(task 6 머지본이 origin 반영되며 발동)에 **전부 소실**. `HEAD==origin/main`(폴러 idle) 확인 후 재편집 → **commit+push 묶어** 실행해 영속·배포.
  - 검증 모델: 로컬 UI 육안 불가(인증+상세뷰) → 라이브 확인으로 위임. 배포 확인은 폴 로그 + 서빙 번들 해시=로컬 빌드 해시 대조로 대체.
  - 슬롯 충돌: 실행 전 활성 슬롯을 미검증·미회고 task 6(settings-batch-hub)이 점유 → 사용자 합의로 `.forge/executed/`에 park(verified: pending 상태 park는 비표준) 후 task 7 promote·실행.
  - 플랜 자체(WHAT)는 무발산 → 재그릴링 불필요. 발산은 전부 실행/환경 측.

## Learnings
- Do differently next time:
  - **배포 폴러 = 인플레이스 편집의 적**: 메인 체크아웃 tracked 편집은 commit+`git push origin main`을 **한 호출로 묶어** 즉시 origin에 올린다(로컬-앞선 창을 ms로 축소). 편집 전 `git rev-parse HEAD`==`origin/main` 확인(다르면 곧 reset). `.forge`(untracked)는 reset --hard 대상 아님 → forge 상태는 항상 보존.
  - **프론트 배포 검증 without 로컬 UI**: `npm run build`로 컴파일 게이트 → push → 서빙 번들 해시(`curl -s localhost/ | grep index-*.js`)가 로컬 빌드 해시와 일치하면 변경 배포 확정. 시각 판정만 사용자에게 위임.
  - **공유 클래스는 스코프로**: 전역 `.tab-btn`(5개 화면 공유)을 건드리지 않고 `.reports-sidebar .tab-btn`로 스코프 → 한 규칙으로 사이드바 두 행 동시 정돈 + 타 화면 무영향. 공유 토큰 수정 전 사용처 grep 습관.
  - **슬롯 위생**: park된 task 6은 verified: pending — 정석은 sealable만 park. 다음에 task 6 검증→회고→봉인 필요(미완 추적).

## Doc updates
- CONTEXT.md promotion: none (순수 UI, 신규 도메인 용어 없음)
- ADR added: none (CSS 스코프 선택은 되돌리기 쉬움; 폴러는 기존 인프라 사실이지 내가 고른 트레이드오프 결정 아님 — ADR 3조건 미달)
- CLAUDE.md: Deployment 섹션에 자동 배포 폴러 주의 1항 추가(사용자 승인) — 메인 체크아웃 미커밋 편집 소실 방지
- auto-memory: `project-deploy-poller-wipes-local-edits` 신규 저장(+MEMORY.md 인덱스)
