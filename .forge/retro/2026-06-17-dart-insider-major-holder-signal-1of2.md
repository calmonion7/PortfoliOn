# 2026-06-17 — DART 내부자·5% 지분공시 신호 백엔드 (task#62, 1of2)

## Plan vs actual
- What went as planned: S1~S7 전부 met. `stock_insider_trades`(row_hash PK) + app_schema.sql/main._migrate 멱등, `insider_trades.py`(elestock/majorstock 수집·_num 방어 파싱·corp_code map 재사용), `compute_net_signal`(저장값 SQL 집계·요청경로 라이브 DART 0), `GET /report/{ticker}/insider-trades`(catch-all 앞)·`POST refresh`(admin), `insider_fetch` 배치(07:45), digest·dashboard additive. Dynamic Workflow 8에이전트(Core 단일→Surfaces 3병렬→Docs→적대적 리뷰 2+계획검증). pytest 735, blocking 0. **배포 후 실데이터 read-only 검산: 오저장 0**(삼성물산 major5 after≈11.5억주·rate 19.7% 정합, 부호 보존, ×100/garbage 없음).
- Divergences:
  - 커버리지 "보유∩관심"→**union** 재해석(종목은 holding/watchlist 중 하나라 교집합 공허 — disclosures 선례대로 `type IN(...)`). 계획 오타.
  - **(medium, 실데이터 무실해) compute_net_signal이 insider(특정증권등)+major5(보유주식등)를 단일 net으로 합산** — 동일인 중복계상·단위 비가환 우려. 실검산: 005930 net −22.4M은 삼성물산(major5) 단독 견인, major5∩insider 보고자=공집합 → 실제 중복 없음. 다만 설계 한계 잔존(→ 후속 후보).
  - **(medium, 무징후) value 기반 row_hash 충돌 가능성** — DART 응답에 rcept_no 내 행-판별자(시퀀스/변동일) 부재. 실데이터 count 정상(삼성30·현대차454)이라 붕괴 징후 없음(→ multi-row 동일수치 발견 시 chg_dt 등 추가).
  - (low) 행 영구 누적(upsert만, TTL 없음 — 신호정확도 무영향, disclosures와 동일 패턴), 요청경로 per-card SQL 집계(supply_score처럼 사전계산 아님 — 풀고갈 없음).
  - CLAUDE_COWORK_API.md 무변경(정당 — read-only 피드, Cowork enrich 무관, disclosures 선례 동일).

## Learnings
- Do differently next time:
  - **다신호 합성에서 "이질적 출처를 한 합으로 더하면" 중복계상·단위혼합을 의심하라** — 적대적 정확성 리뷰가 이 conflation을 잡았고(실데이터선 무실해였지만 설계상 valid), 같은 패턴([[수급 스코어]] 신호별 척도 통일)의 재현. 신호 합성 시 출처별 분리 집계 가능성을 리뷰 체크리스트화.
  - **value 기반 dedup 해시는 행-판별자 부재 시 동일수치 행 붕괴 위험** — 멱등성은 보장되나 "서로 다른 진짜 행 구분"은 깨질 수 있음. 외부 API 응답에 안정 행키가 없으면 라이브 재적재 UAT로 검증(fixture로 못 잡음).
  - **데이터 파싱 변경은 배포 후 실데이터 검산이 fixture보다 강하다**(기존 CLAUDE.md 규칙 재확인) — wrong<missing가 실데이터(삼성물산 대량보유 등)에서 오저장 0으로 입증.
  - **prod 배치 쓰기는 사용자 경유**([[reference-prod-writes-need-user]]) — 사용자가 insider_fetch admin 실행 → 내가 GET 엔드포인트로 read-only 검산 대행(supply_score 패턴 정착).
- 검증 게이트: pytest 735·계획검증 S1~S7 met·적대적 리뷰 2(blocking 0)·라이브 검산(오저장 0) → verified: yes. 커밋 48ed000a push.
- 후속 후보: ① compute_net_signal report_kind별 분리 집계(conflation) ② row_hash에 행-고유 필드(multi-row dup 발견 시) ③ ranking/list 배지용 insider 필드 확장(backend).

## Doc updates
- CONTEXT.md promotion: none ([[지분공시 신호]]는 fg-ask 때 등재).
- ADR added: none (기존 DART/공시 패턴 내, hard-to-reverse·surprising 3조건 미충족 — 계획 명시).
- CLAUDE.md: 다이제스트 NaN 직렬화 gotcha 1건 승격(2of2 retro의 교차 발견 — UAT 중 노출된 선존 버그, 커밋 8cd70a42).
