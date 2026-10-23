# RUN — task#389 루틴 fire 리스너 네이티브 claude 고정 + 사전 점검

실행: 2026-10-16 (fg-loop 드라이브, 직접 실행 — 단일 파일 규모라 워크플로 생략)
작업 브랜치: `routine-fire-claude-binary-pin` (워크트리 `../PortfoliOn-wt389`, origin/main `177c14c`에서) · 커밋 `9e09d91` · PR #20

## 슬라이스
- S1 `_runner_argv` claude 절대경로 + `_runner_problem` 사전 점검 + do_POST 500 — ✅ 계획대로 (TDD 빨강→초록)
- S2 PR #20 생성 — ⏳ 머지 대기(사람 몫). 배포 판정(DoD 3)은 머지 뒤
- S3 npm uninstall — ⏸ 미착수 (S2 배포 확인 뒤, 사전 승인됨)
- S4 ASML 즉시 발행 — ⏸ 미착수 (S2 뒤, 사전 승인됨)
- S5 야간 enrich 수동 1회 — ⏸ 미착수 (S4 세션 종료 뒤, 사전 승인됨)

## DoD baseline → after
- DoD1 리스너 테스트: 23 passed + 신규 ⓐⓑⓒ 3 failed(빨강 — ⓐ 200 queued, ⓑ workdir 생성, ⓒ bare "claude") · ⓓ 사전 통과(회귀 가드) → 26 passed
- DoD2 전체 pytest: → 2558 passed (작업 브랜치)
- DoD3 실행 사본 grep `local/bin/claude`: 0 → 0 (미배포, 머지 대기)
- DoD4 npm claude-code 디렉터리: 존재 → 존재 (미착수)
- DoD5 ASML analyst_reports: (계획 사전상태 `[]`) → 미착수
- DoD6 야간 enrich: 미착수

## 계획 대비 차이
- ⓑ(단일 모드 500)는 현 코드에서도 Popen OSError가 500으로 떨어져 **이미 통과**할 수 있었다 → 「점검이 스폰 전이라 run workdir이 생기지 않는다」를 단언에 더해 빨강을 냈다(현 코드는 mkdtemp 후 Popen이라 빈 workdir이 남는다).
- 사전 점검 테스트는 fixture가 갈아끼운 Popen을 진짜로 되돌려 tmp 스크립트를 실제 exec한다(`subprocess.run`이 모듈 전역 Popen을 쓰므로 patch된 채로는 점검을 잴 수 없다).
- opencode 경로도 점검을 탄다 → `/opt/homebrew/bin/opencode --version` rc=0(1.18.30) 확인. 야간 enrich는 model=opus(claude 경로).
- 워크트리에 `backend/.env`가 없어 conftest가 SESSION_SECRET로 죽음 → 메인 체크아웃 `backend/.env` 심링크(untracked)로 실행.
- 리스너는 `/usr/bin/python3`(3.9)로 돈다 — `str | None` 같은 3.10 문법을 쓰지 않았다.

## 재개 시 할 일 (머지 후)
S2 배포 판정(DoD3) → S3(DoD4) → S4(DoD5) → S5(DoD6) 순서로 이어서 실행한 뒤 UAT. 일반 「검증만 재개」가 아니라 남은 실행 슬라이스가 있다.
