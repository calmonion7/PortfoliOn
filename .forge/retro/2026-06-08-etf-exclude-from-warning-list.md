# 2026-06-08 — ETF 경고 서브탭 제외 (task 20) + 세션 전반(task 18·19·20) 학습

> task 18(미생성 오분류+여백)·19(배치 회복력)는 저발산으로 retro skip 봉인됨. 세 작업의 cross-cutting 학습을 여기 한 번에 정리.

## Plan vs actual
- What went as planned (task 20):
  - 백엔드 `/api/report/list`에 `is_etf` 노출(storage 두 포트폴리오 SELECT + `_mk_entry`) + 프론트 `_hasWarning(s, isEtf)` ETF면 false. API 문서 2개 동기 갱신. 백엔드 457 passed, 프론트 빌드 통과. 사용자 라이브 UAT: KODEX가 관심 "⚠ 경고" 서브탭에서 사라짐 확인.
  - `tickers.is_etf` 컬럼 기존 존재(etf-report-tabs 잔재) → 마이그레이션 불필요.
- Divergences:
  - **(task 19) 전제가 뒤집힘 — 핵심**: 사용자/플랜은 "ETF 생성 버그"를 의심했으나, 컨테이너에서 직접 재현하니 **KODEX는 정상 생성**(quote 131,030·RSI 61.93, 컨센서스만 빈 값=정상). 재현되는 ETF 생성 버그 없음. 스킵의 정체는 `generate_report`가 `price is None`(외부 fetch 일시 실패)일 때 ValueError→배치가 무재시도로 건너뜀. AskUserQuestion으로 전제 정정 후 범위 재합의.
  - **(task 19) 부분 누락 복구 보강**: `_check_missed_report`를 종목별로 바꾸며 기존 `_generate_all`의 `_pipeline.run_daily` 동작 보존을 위해 누락분에 명시 호출 추가(플랜 미명시, 회귀 방지·범위 내).
  - **task 20은 fg-run 도중 발생한 신규 요구**: 활성 작업(18)에 끼워넣지 않고 별도 backlog task로 분리해 순차 처리(18 봉인→19→20).
  - 그 외 task 18·20은 플랜과 일치(저발산).

## Learnings
- Do differently next time:
  - **"X가 Y를 유발한다"는 버그 프레이밍은 코딩 전에 데이터로 인과사슬을 검증**. 이번엔 DB 조회(스냅샷 날짜·요일·스케줄)로 "ETF라서가 아니라 06-05 평일배치 누락 + 06-07 최신리포트 + 날짜-멤버십 판정"임을 먼저 확정 → 표시 로직 1줄 수정으로 귀결. ETF/생성기를 헛파지 않음. (긍정 확인: 재현이 가장 강한 증거 — KODEX 생성 직접 호출로 "버그 없음" 확정.)
  - **`미생성` 정본 정의 = "최신 리포트 날짜 < 마지막 스케줄일(또는 없음)"** — "정확히 그 스케줄일 포함" 멤버십이 아님. 주말 수동 생성 등 더 최신 리포트가 있으면 미생성 아님. (CONTEXT.md 반영 완료.)
  - **ETF는 애널 컨센서스(buy/hold/sell·target_mean) 부재**가 여러 분류에서 오작동을 만든다: 경고(≤10명)·미생성·목표≥40% 버킷. is_etf 플래그로 분기하되, 목록(`/api/report/list`)과 상세(`/report/{ticker}/{date}`)는 **데이터 경로가 분리**돼 둘 다 배선 필요(etf-report-tabs 회고 교훈 재확인 — 소비 화면 fetch 경로부터 역산).
  - **부수효과는 플랜에 명시하고 사용자에게 고지**: ETF 경고 제외 시 target 없는 ETF가 "목표≥40%" 버킷으로 이동 — 무한정 방치 대신 플래그.
  - **배포 메커니즘(인프라 사실)**: nginx가 `./frontend/dist:/usr/share/nginx/html:ro`를 **직접 서빙** → 로컬 `npm run build` 즉시 라이브(서빙 번들 해시=로컬 빌드 해시로 검증 가능). `git push`는 폴러 재배포/영속·백엔드 반영용. 백엔드 변경(예: is_etf)은 폴러 재배포 후에야 라이브 → 프론트만 먼저 살면 `v.is_etf=undefined`로 기존 동작.
  - **검증 비대칭 처리**: 일시 fetch 실패(task 19)는 라이브 UAT 불가 → 단위테스트가 유일·충분한 검증. 표시/UI(task 18·20)는 라이브 시각 UAT. 작업 성격에 맞는 검증수단 선택.

## Doc updates
- CONTEXT.md promotion: none this session (`미생성`은 fg-ask 단계에서 이미 추가; `경고`는 UI 서브탭 규칙이라 구현 영역 — 글로서리 부적합).
- ADR added: none (재시도·백필·is_etf 노출·판정 1줄 모두 되돌리기 쉬움 → ADR 3조건 미달).
- CLAUDE.md: Deployment 섹션에 "frontend/dist 호스트마운트(:ro) → npm build 즉시 라이브, 백엔드는 폴러 재배포 후 반영" 추가 완료(사용자 승인, commit 1ba48b0b).
- auto-memory: 후보 없음(dist 마운트는 docker-compose.yml에 기재돼 repo가 이미 기록; ETF/미생성 판정은 코드+CONTEXT에 반영).
