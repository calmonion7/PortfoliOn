# 2026-06-27 — 죽은 코드/의존성 정리 (ponytail-audit 후속, task#106)

## Plan vs actual
- What went as planned: 5건 삭제(charts.py+matplotlib, react-markdown+remark-gfm, @vite-pwa/assets-generator, vite markdown 청크 분기, _DAY_MAP) + README·STACK 동기. 검증 전부 green(프론트 build 성공, 백엔드 pytest 879 passed, 잔여 grep 0). 코드 작업 자체는 계획대로, 분기 거의 없음.
- Divergences:
  - **[중대] 자동배포 폴러가 작업 중 fg-map 지도 커밋(`ca933467`)을 소실**시킴. dangling commit을 cherry-pick(`a040cdf8`)+즉시 push로 복구. 폴러 스크립트(`scripts/auto-deploy-poll.sh`)를 직접 읽어 메커니즘 확정: `if LOCAL == REMOTE then exit 0; else git reset --hard origin/main; deploy.sh` — 즉 **`LOCAL != origin/main`이면 양방향(로컬이 앞서도) 무조건 reset**. push 안 한 로컬 커밋도 reset 대상. reflog의 `reset: moving to origin/main`이 내 커밋 위에 덮인 것으로 재확인.
  - 검증 순서: 폴러 리스크 때문에 push 전 로컬 검증을 먼저 완료(평소 "검증은 머지 후" 워크플로우와 순서 다름). 결과 동일(green) 후 commit+push.
  - 범위 밖: `npm audit` 6건(1 low/1 mod/4 high) 잔존 — 이번 변경 무관, 미처리.

## Learnings
- Do differently next time:
  - **메인 체크아웃에서 만든 커밋은 commit 즉시 push해야 산다 — commit-without-push는 다음 폴(≤2분)에 reset으로 소실.** fg-map처럼 "커밋만 하고 push는 사용자 요청 시"로 미루면 폴러가 wipe한다. 지도/문서 커밋도 예외 아님.
  - 배포 메커니즘을 단정하기 전 **스크립트를 직접 읽어 조건을 확인**(task#104 과잉결론 교훈 재확인) — 이번엔 폴러 reset 조건을 로그/추정이 아니라 소스로 규명.
  - 삭제 작업의 완료 게이트는 slice별 grep-0 + build/test green('wrong < missing'의 역방향: 쓰는 걸 지우는 위험).

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음)
- ADR added: none (기존 인프라 동작 사실, 우리가 내린 결정 아님)
- CLAUDE.md: 배포절 2곳 정정 — 폴러 트리거를 "origin이 앞설 때만"→"`LOCAL != origin/main` 양방향 + 항상 reset --hard", commit-without-push 소실 명시(task#104·106). 메모리 `project-deploy-poller-wipes-local-edits` 강화.
