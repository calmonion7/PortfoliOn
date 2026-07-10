<!-- forge-slug: event-calendar-expansion-2of3 -->
# 2026-06-28 — 이벤트 캘린더 확장 2/3 (주주총회 일정) (task#120, part 2/3)

## Plan vs actual
- **계획대로**: 4 phase(Spike 게이트 → Implement → Surface → Review). 스파이크가 DART 키를 `.env.docker`서 로드해 005930·000660 주총공고 document.xml 실프로브 → 추출 가능 확정 후 진행. `services/agm.py`(2전략 파서+배치)·`meeting_date` 멱등 마이그레이션·`agm_fetch`(KR·daily, 수동 admin)·캘린더 `agm` 이벤트·프론트 범례·README/API_SPEC. pytest 957·build green. 라이브 추출 2종목 MATCH(005930→2026-03-18, 000660→2026-03-25). 커밋 `a552e75b`.
- 게이팅 스파이크 패턴이 유효했음 — 불확실 소스를 헛구현 전 라이브로 검증.

## Divergences
- **D1 (correctness, 메인세션 in-run 수정 — Review가 놓침)**: 배치 증분 스킵이 재발 안전치 못함. 원안 "티커에 해결된 주총 하나라도 있으면 스킵"→올해 해결 후 **내년 주총 영영 미fetch**(연례 캘린더가 다음 시즌 조용히 죽음). 수정: 이른 스킵 제거→`_fetch_agm_list`(싼 list.json)로 최신 rcept_no 먼저 구하고 *그 rcept_no가 해결된 경우만* document fetch 스킵(신규 연도=새 rcept_no→재fetch). 재발 안전 테스트 추가.
- **D2 (DART 사실)**: list.json `pblntf_ty` 지정 시 주총 0건 — AGM은 no-type 호출로만 발견(disclosures.py 유형별 호출이 놓침). agm 배치가 자체 no-type 호출 + self-insert.
- **D3 (doc-drift)**: CLAUDE.md "scheduler.py 루트 레벨" stale — 실제 `backend/scheduler/` 패키지.
- **계절성**: 현재 KR 주총 대부분 과거(2026-03) — 캘린더 미래 노출은 다음 공시 시즌(~2027-02)부터(데이터 주도). 배치 동작·populate는 배포 후 확인.

## Learnings
- **Do differently next time**:
  - **적대적 Review에 "시간/재발성 동작" 렌즈를 추가하라.** 이번 Review는 파싱·마이그레이션·graceful·무회귀는 봤지만 **배치가 *두 번째 시즌에도* 동작하나(증분이 재발을 막지 않나)**는 안 봐 재발 결함을 놓쳤다(D1, 메인세션이 포착). 배치/시계열/캐시 기능 리뷰엔 "내년/다음 주기에도 갱신되나? 증분 스킵이 신규 데이터를 영구 배제하지 않나?"를 명시 렌즈로.
  - **외부 목록 API는 필터 차원에 사각이 있을 수 있다** — DART list.json은 `pblntf_ty` 지정 시 주총을 통째 누락(no-type로만 발견, D2). "기존 호출 패턴 재사용"이 새 데이터 종류엔 안 통할 수 있으니 스파이크에서 라이브로 확인할 것(이번 스파이크가 잘 잡음).
  - **게이팅 스파이크는 불확실-소스 작업의 비용 보호** — 추출 가능 확정 후에만 구현 진입(헛 워크플로 방지). 소스 불확실 파트의 표준 1슬라이스로.

## Doc updates
- CLAUDE.md: **gotcha 1건 추가**(agm.py + DART AGM no-type 발견·document.xml 회의일 2전략·증분 재발안전, disclosures gotcha 인접) + **stale 줄 정정**(scheduler.py→scheduler/ 패키지) (사용자 승인 D2·D3).
- CONTEXT.md promotion: none (주총/agm = 일반 개념).
- ADR added: none (배치/파싱은 기존 backlog/disclosures 패턴 내; 되돌리기 쉬움).
- **후속 후보(누적)**: #119 D4 `_warm_calendar_cache` 기동-FRED 가드(fg-quick), FOMC 정적 일정, 그리고 #121 캘린더 3/3(KR 실적).
