# 2026-06-22 — 대시보드 500 NaN/inf 직렬화 fix + 배포 누락 발견 (task#104)

## Plan vs actual
- What went as planned:
  - 근본을 `_portfolio_totals` NaN→직렬화 500(CONCERNS §3)으로 확정. Playwright/fetch 직접 프로브로 cold dashboard 6/6 500 재현, unit test로 `ValueError: Out of range float values are not JSON compliant` red 재현. fix: `_usdkrw_rate` isfinite 가드 + `_build_all` 반환 sanitize. 878 passed.
  - 배포 후 직접 검증: cold dashboard 500→200, holdings=5 채워짐, totals finite, NaN 0.
- Divergences (큼):
  - **🚨 진짜 미해결 원인 = 배포 누락(코드 아님)**: fix 푸시 후에도 라이브 500 지속 → 배포 로그상 마지막 백엔드 배포가 2026-06-20(6793157d), 이 세션 백엔드 커밋(#95~#104) *전부 미배포*. 사용자 `bash deploy.sh` 1회로 전부 라이브, 500→200 확인.
  - **task#102 진단이 틀렸음**: #102는 근본을 "콜드 풀 경합 per-card throw"로 추정했으나, 실제 500은 줄곧 `_portfolio_totals` totals NaN 직렬화(per-card 가드 *위* 단계)였다. #102의 per-card graceful은 유효하나 *진짜 500*은 못 막았다.

## Learnings
- Do differently next time:
  - **🔴 이 배포 체크아웃(`/Users/calmonion/Project/PortfoliOn`)에서 직접 commit→push하면 자동배포가 안 된다**: 폴러(`scripts/auto-deploy-poll.sh`)는 `LOCAL HEAD != origin/main`(origin이 로컬보다 앞설 때)만 `deploy.sh`를 돌린다. 그런데 이 체크아웃에서 commit하면 LOCAL이 함께 전진→push 후 LOCAL==origin→폴러 "up to date" 스킵→**deploy.sh 영영 안 돎**. 프론트는 nginx가 `frontend/dist` 직접 서빙(npm build=즉시 라이브)이라 보이지만, **백엔드 변경은 `bash deploy.sh` 수동 실행이 필요**(working tree로 이미지 rebuild). → CLAUDE.md 배포 절 "git push=자동배포"가 *이 워크플로우에선 거짓*이라 갱신.
  - **백엔드 fix가 라이브에서 안 먹으면 *코드 재진단 전에 배포부터 확인*하라**: #101·#102에서 "또 안 고쳐졌다"를 코드 문제로 재진단했지만, 실은 미배포라 어떤 코드 fix도 라이브 반영이 안 됐던 것. `tail 배포로그` / cold 프로브 타이밍(코드 바뀌면 변함)으로 배포 여부 먼저 확인. ("tests green ≠ live" — 이 세션 백엔드 task들의 verified:yes(tests)는 실제론 라이브 미확인이었다.)
  - **직접 재현(Playwright/fetch 프로브 + unit red)이 결정타**: 추측 누적을 끊고 정확한 에러(`Out of range float ... not JSON compliant`)·라이브 500/200을 직접 봐서 근본을 확정. "직접 테스트해줘" 요청이 옳았다.
  - NaN 출처(저장 FX가 왜 nan이었나)는 미규명 — fix는 출처 불문 sanitize+isfinite로 graceful. FX 데이터 오염 근본은 후속 후보.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (배포 footgun은 새 결정이 아니라 운영 현실 — ADR 부적합, CLAUDE.md 가토가 적소)
- **CLAUDE.md 갱신(승급)**: ① 대시보드 가토에 "진짜 근본=totals NaN 직렬화 500, isfinite+sanitize"(이미 task#104 S3) ② **배포 절에 "이 체크아웃 직접 commit→push는 폴러 미배포(LOCAL==origin), 백엔드 변경은 `bash deploy.sh` 수동 필요"** 추가(actively-wrong 가이드 정정, 재발 방지).
