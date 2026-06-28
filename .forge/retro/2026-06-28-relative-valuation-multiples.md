# 2026-06-28 — 상대 밸류에이션 멀티플 (task #112)

## Plan vs actual
- What went as planned: S1~S4 MET. `_comp_valuation`(경쟁사 PER/PBR US info·KR Naver rv12/14, ThreadPool) + `summary.psr`(US info·KR 시총÷TTM매출 파생)·`summary.ev_ebitda`(US, KR None). 프론트 `ReportDetailHeader` 뱃지 + `Sections` 경쟁사 카드 행. README 갱신. 신규 테스트 4/4, 전체 910 passed. 라이브 추출 확인(AAPL/MSFT/005930).
- Divergences (경미):
  - **(in-run 해소)** yfinance PSR 키 정정: 계획 `priceToSalesTrailingTwelveMonths` → 라이브 AAPL 확인 결과 None, **실제 키 `priceToSalesTrailing12Months`**. DoD의 "US 1종목 라이브 추출 대조"가 fixture-blind 키오류를 잡음.
  - **(nitpick)** US psr/ev_ebitda 미반올림 vs KR psr round — `_sanitize`가 덮어 무해.
  - **(무관)** pre-existing 실패 5건(#111/#117 import) 그대로.

## Learnings
- Do differently next time:
  - **yfinance `info` 키명도 비직관적이다** — `priceToSalesTrailing12Months`(숫자 12, not `...TwelveMonths`). 메서드/프로퍼티 index 라벨 함정(CLAUDE.md task#117 가토)의 *dict-key판*. 대응은 동일: **새 `info` 키 쓰는 슬라이스는 라이브 1종목 추출 대조를 DoD에**(이번에 그렇게 해서 잡음 — 신규 가토 승급 불요, 기존 가토 재확인).
  - **메타 패턴(이번 세션 3회 반복)**: 갭분석 씨앗(`docs/investment-info-gap-analysis.md`)이 "KR 소스 기존/가능"을 전제하지만 라이브 검증하면 *부재/fragile*인 경우가 반복 — #113 KR 지수 밸류(FRED엔 CAPE 없음), #112 KR EV/EBITDA(Naver 16행에 없음·파생 불가). **씨앗 그릴링 시 KR 데이터 소스는 항상 라이브 실검증하고, 부재면 그 부분만 연기**(wrong<missing). 남은 씨앗(#114 US수급·#115 캘린더·#116 가격기술)도 동일 경계로 그릴링.
  - **열린 follow-up**: ① KR EV/EBITDA(FnGuide 본문 크롤 가용성 재조사 — 이번 연기분) ② `test_financials_kr*.py` import 5건(`from backend.services...`→`from services...`, fg-quick).

## Doc updates
- CONTEXT.md promotion: none (PER/PBR/PSR/EV/EBITDA 일반 재무 용어 — 글로서리 제외 규칙).
- ADR added: none (스냅샷 필드 additive — 기존 report_generator 패턴 범위 내).
- CLAUDE.md: 추가 없음 (yfinance 라이브검증 교훈은 task#117 가토에 이미 문서화 — 이번은 재확인).
