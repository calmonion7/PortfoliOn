<!-- forge-slug: event-calendar-expansion-3of3 -->
# 2026-06-28 — 이벤트 캘린더 확장 3/3 (KR 실적발표일) (task#121, part 3/3·시리즈 완결)

## Plan vs actual
- **계획대로(더 단순)**: 4 phase(Spike 게이트 → Implement → Surface → Review). 스파이크가 #121의 핵심 불확실(전망 KR 실적일 소스)을 해소: **yfinance `.KS`/`.KQ` `t.calendar["Earnings Date"]`가 forward 제공**(5종목 라이브 매치 005930→2026-07-29 등), Naver/DART는 forward 미제공. → 큰 소스 작업 불필요, `calendar._fetch_stock`의 raw-ticker 버그를 `_yf_sym`로 ~3줄 수정. US bare ticker 무회귀. earnings 타입 공용이라 프론트 무변경(문서만). pytest 960·테스트 3건.

## Divergences
- **D1 (스파이크가 범위 축소)**: 계획의 "소스 불확실 → 딥리서치/축소 가능"이 스파이크로 "yfinance .KS 작동 → 3줄 수정"으로 환원. 핵심은 신규 소스가 아니라 **기존 `_yf_sym` 미사용 잠재버그**.
- **D2 (Surface 오해, 무해)**: Surface가 "백엔드 이미 _yf_sym"이라 보고 — Impl이 막 추가한 상태를 관찰한 것(git diff로 raw→_yf_sym 수정 확인). 코드 정상.
- **D3 (한계, 문서화)**: KOSDAQ 커버리지 patchy(yfinance 404 일부), `exchange=""`면 .KS 기본(앱 공통 `_yf_sym` 동작이라 새 리스크 아님), 잠정실적 알림 미구현(과거 발표일·marginal, forward 있어 불요).
- **검증 deferred**: 캘린더 KR 실적 populate는 배포 후(보유 종목 실적일이 해당 월 표시). 로컬 = 라이브 5종목 + 테스트.

## Learnings
- **Do differently next time**:
  - **게이팅 스파이크-우선이 불확실-소스 작업의 비용을 거듭 보호**(#120·#121 연속) — "리스크 큰 소스 헌트"로 보이던 #121이 스파이크 한 번에 "3줄 수정 + 소스 지형 확정"으로 환원. 소스 불확실 파트는 항상 라이브-프로브 스파이크를 1슬라이스로.
  - **외부 소스 헬퍼(`_yf_sym`)를 *우회*하면 조용히 깨진다** — 캘린더가 raw ticker로 yfinance 호출해 KR 실적이 통째 비었는데 에러 없이(빈 리스트) 수개월 잠복. KR 외부호출은 반드시 `_yf_sym` 경유. (CLAUDE.md 박제.)
  - **"소스 없음" 가설을 라이브로 깨라** — KR forward 실적일이 "신뢰 소스 없음"일 거란 그릴링 가정이 yfinance .KS 라이브 확인으로 반증됨. 비관적 가정도 스파이크로 검증할 가치.

## Doc updates
- CLAUDE.md: **gotcha 추가**(calendar.py 인접) — 캘린더 이벤트 타입 목록 + **KR 실적일=yfinance .KS/.KQ 유일 forward 소스(Naver/DART 없음)·`_yf_sym` 필수(raw ticker면 KR 0건)·KOSDAQ patchy** (사용자 승인).
- CONTEXT.md promotion: none. ADR added: none(기존 캘린더/yfinance 패턴 내).
- **후속(누적, 미해결)**: #119 D4 `_warm_calendar_cache` 기동-FRED 가드(fg-quick), FOMC 정적 일정, #114 US 수급(미그릴링). 시리즈 #115는 이로써 완결.
