# 2026-06-27 — 재무 현금흐름·커버리지 FCF·이자보상 KR(DART)/US(cash_flow) (Part 2/2)

## Plan vs actual
- What went as planned:
  - 구조/설계 적중: `get_annual_financials_kr/us`에 fcf·interest_coverage 키 추가 → report_generator·배치·테이블 변경 0(Part 1 패턴 재사용). account_id 매칭 설계, 이자보상 분모=이자의지급(금융비용 아님), 음수 FCF 비클램핑, 연간 전용 표시(FinancialsChart isAnnual 게이트), 공용 `_safe_ratio`. graceful(DART키 부재 early-skip). 단위테스트 24 passed, 프론트 빌드 OK.
- Divergences (높음 — 라이브-only 버그 2개, UAT서 포착·수정):
  1. **KR DART fnlttSinglAcntAll의 fs_div(이중 버그)**: (a) `fs_div`를 요청 파라미터로 안 보내 status 100 "필수값 누락" → 전부 None. (b) `_dart_extract_3y`가 응답을 `row.get("fs_div")`로 필터했으나 fs_div-요청 응답은 그 필드를 echo 안 함 → 전 행 스킵. 수정: 요청 fs_div=CFS→OFS 폴백, 응답 필터 제거, silent except를 logger.warning으로(버그를 숨겼던 원흉), 테스트에 fs_div 요청 단언 추가.
  2. **US yfinance 메서드/프로퍼티 라벨 불일치**: 워크플로우가 `t.cash_flow` 프로퍼티(공백 라벨)를 썼는데 `_yf_val`은 무공백 조회 → fcf 전부 None(income_stmt/balance는 get_* 메서드라 정상이었음). 수정: `t.get_cashflow(freq='yearly', as_dict=False)` 메서드.
  - 라이브 검증: 삼성 2024 FCF +21.58조·ic 48.48(손계산 정확 일치), 2023 −13.47조(음수 보존), AAPL FCF +108.8B·MSFT ic 37~54. Part 1 US 비율(opM 31.97·roe 151.91·debt 387·quick 85.9)은 무영향(get_balance_sheet 메서드).

## Learnings
- Do differently next time:
  - **외부소스 데이터 파싱은 단위테스트(mock)로 끝내지 말고 라이브 UAT 필수** — Part 1 회고가 경고한 "fixture 통과·실데이터 실패"가 **그대로 재발**(이번엔 한 작업에서 KR·US 둘 다). mock은 요청 누락·라벨 불일치를 못 잡는다. **외부 API 신규 연동 슬라이스의 완료기준에 "라이브 1종목 추출 대조"를 명시**할 것. + `except: pass`는 버그를 숨겨 진단을 막으니 logger.warning 필수(CLAUDE.md "silent except 금지" 재확인 — 이번 KR 버그를 정확히 그게 숨겼다).
  - **DART API군은 엔드포인트마다 필수 파라미터·응답 형태가 다르다**: `fnlttSinglAcntAll`은 fs_div 요청 필수 + 응답에 per-row fs_div echo 안 함(단일 fs); `fnlttSinglAcnt`(주요계정)는 fs_div 불필요 + 응답에 fs_div echo. 기존 코드 패턴을 다른 DART 엔드포인트에 복붙하면 깨진다. → CLAUDE.md 가토 등재.
  - **yfinance는 get_*() 메서드(무공백 라벨)와 .property(공백 라벨)의 index가 다르다** — `_yf_val`(exact 매칭)엔 반드시 get_income_stmt/get_balance_sheet/get_cashflow 메서드 사용. → CLAUDE.md 가토 등재.
  - account_id 매칭·이자의지급 분모·연간 전용 등 직전 세션 그라운딩 결정은 전부 옳았음(설계는 무결, 버그는 순수 연동 디테일).

## Doc updates
- CONTEXT.md promotion: none — 도메인 용어 아님(통합/구현 가토).
- ADR added: none — 되돌리기 힘든 결정 없음.
- CLAUDE.md Gotchas: **2건 추가**(사용자 승인) — ① DART fnlttSinglAcntAll fs_div 요청필수·응답 미echo, ② yfinance get_*() 메서드 vs .property 라벨 규칙 차이.
