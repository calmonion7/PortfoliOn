# 2026-07-07 — 다음날 코스피 방향 신호 (오버나잇 프록시) + 적중률 누적 (task#154)

Dynamic Workflow 4-phase(Build S1→S2∥S3→S4 → 적대적 Review 2렌즈 → Fix → Gate), eco(sonnet 캡+ECO). 에이전트 8·에러 0. 저divergence. 배포(f8b9571)·verified: yes.

## Plan vs actual
- What went as planned:
  - 4슬라이스 계획대로: `kospi_signal.py`(합성·±0.5 밴드·judge_hit·reconcile·all-None/NaN 가드·stored-only read, 19테스트) + `kospi_signal_fetch` 배치(KR·평일 08:30) + GET/POST 엔드포인트 + API_SPEC + `KospiSignalSection`(강세=--up/약세=--down 가격토큰) + README. Gate 백엔드 pytest **1196 pass**·프론트 vite build ok.
  - **배치 카운트 하드코딩 단언 4파일 전부 갱신됨**(CLAUDE.md 가토 사전 반영: test_batches_router EXPECTED_IDS+==29, test_batch_market_split ==29+KR 16, test_macro_signals_batch ==29, test_scheduler_seed 2개 set) — 계획 S2에 명시한 덕에 누락 없음.
  - 라이브 프로브: 실드라이버(sp500+0.72/nasdaq+1.12/usdkrw−1.13)→composite +0.99%→bullish, judge_hit 정합, ^KS11 OHLC 실fetch. 외부데이터 신호 산출 라이브 확인(fixture-pass-live-fail 회피).
- Divergences (전부 저위험):
  - **적대적 리뷰 correctness 1건 → Fix**: 문서·프론트 문구가 실제결과를 "T-3일차 확정"으로 표기 — **플랜의 "T-3"(검증대상 옵션3 라벨)를 'T minus 3일 지연'으로 오독**. 실제 reconcile은 지연 없이 ^KS11 일봉 뜨면 즉시 채움 → Fix가 문구 정정. integration 렌즈는 클린(0).
  - **병렬 스냅샷 타이밍(파생 아님)**: S3가 S2 batch 등록은 봤으나 테스트 카운트 수정 전 스냅샷을 봐 일시 5-fail 보고, 최종 Gate 그린. 실제 회귀 아님.
  - 기동 시드 생략(YAGNI, 플랜 "(선택)") — 연속일 누적으로만 가치 → 1회 fetch 무의미.

## Learnings
- Do differently next time:
  - **플랜의 옵션 라벨을 "T-1/T-2/T-3"처럼 T+숫자꼴로 쓰지 말 것** — 실행 에이전트가 타이밍(T±N일)으로 오독해 문서/UI 문구에 잘못 반영한다(이번엔 적대적 리뷰가 잡아 Fix). 옵션은 "옵션A/B/C" 등 타이밍과 안 겹치는 라벨로.
  - eco 워크플로우(sonnet 캡+ECO 주입) + 적대적 2렌즈가 저비용으로 잘 작동 — correctness 렌즈가 문구 오독을, integration 렌즈가 배치/doc-sync 가토를 커버. 배치 id 추가 시 카운트 단언 4파일을 *플랜 슬라이스에 미리 못박은* 게 누락을 막았다(반복 유효 패턴).
- 검증 게이트: pytest 1196·프론트 빌드·적대적 리뷰(1건 Fix)·라이브 프로브 bullish 산출 → verified: yes. 배포 후 시각/08:30 배치 실적재는 repo 관례 후속 글랜스.

## Doc updates
- CONTEXT.md promotion: none — 「다음날 코스피 신호」는 fg-ask 그릴링서 이미 등재([[매크로 신호]]·매크로 상관·선물과 구분).
- ADR added: none — 프록시 소스 선택은 국소·가역(후속 선물 확보 시 additive 4번째 드라이버). 하드결정 3게이트 미충족.
