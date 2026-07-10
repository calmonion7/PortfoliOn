# 2026-06-27 — 재무 건전성·수익성 비율 6종 KR/US (Part 1/2): 순이익·영업/순이익률·ROE·부채/당좌비율

## Plan vs actual
- What went as planned:
  - 3슬라이스 전부 계획대로. **S1 KR**(`market/kr.py`): `get_financials_kr`·`get_annual_financials_kr`에 6키(net_income=row2×1e8, operating_margin=row5, net_margin=row6, roe=row7, debt_ratio=row8, quick_ratio=row9) additive 추출. **이미 호출 중인 Naver 응답에서 row만 추가** — 신규 외부호출 0. **S2 US**(`__init__.py`·`us.py`): per-period 파생, divide-by-zero·비유한 가드를 공용 `_safe_pct`로 통일. **S3**(`FinancialsChart.jsx`): 순이익 라인 + 수익성%·안정성% 2차트.
  - 회귀 테스트 2파일 신규(`test_financials_kr.py` row매핑 fixture+graceful None / `test_financials_us_ratios.py` _safe_pct 가드) — 백엔드 15 passed, 프론트 빌드 OK.
  - eco 워크플로우 패턴 잘 맞았음: KR·US가 **파일 분리**(kr.py ↔ __init__.py/us.py)라 병렬 2에이전트(sonnet)로 충돌 없이, 키 계약을 양쪽에 동일 주입해 발산 차단. 4에이전트·~250s.
- Divergences:
  - **`_safe_pct` 위치**(낮음·긍정): 계획 "둘 중 한 모듈" → 에이전트가 공용 `market/format.py`에 두고 re-export/import. 6곳 중복 가드를 한 줄 헬퍼로(eco) — 더 깨끗.
  - **Naver 최근/forward 기간 값이 직관과 어긋남**(중간·관찰): 005930의 2025-09→12→2026-03→06 기간이 영업이익률 14→21→42→50%, 매출 ~170조로 비정상 스케일로 보임. **추출은 충실**(각 기간 op/매출과 내부 일관, raw Naver 프로브 대조 일치)이고 **기존 revenue/op/PER 추출이 이미 같은 기간을 노출하던 패턴과 동일** — 내 변경의 오류가 아니라 Naver 데이터 특성. 깨끗한 직전 actual 분기(2025-03=8.45%)·은행(105560) 전 기간은 정상.

## Learnings
- Do differently next time:
  - **외부 API의 row/필드 인덱스 주장은 "라이브 프로브로 확정 → fixture로 못박기"가 효과적**(직전 갭분석 회고의 "재검증" 권고를 실행). 이번에 4종(삼성 분기/연간·은행·테크) 교차 프로브로 갭 보고서의 row 매핑(2/5/6/7/8/9)이 옳음을 확인하고 fixture 테스트로 향후 Naver 레이아웃 드리프트를 검출하게 함. **Part 2(task#117)의 DART account_id 매칭도 동일 패턴 적용**(account_nm 변동·account_id 안정 이미 라이브 확인 완료).
  - **Naver 분기 재무(`finance/quarter`)의 최근/forward·컨센서스 기간은 단일분기/누적/추정 의미가 불명확해 값이 부풀어 보일 수 있다 — 비율 차트가 50% 같은 값을 보이면 표시 버그가 아니라 *소스 데이터 의미*를 먼저 의심**. 추출 정확성(내부 일관·raw 대조)과 데이터 의미는 별개. (재무 비율을 새로 노출할 때 반복될 함정 — 직전 actual 분기·다른 업종 종목으로 sanity 대조하면 추출/소스 구분 가능.)
  - **스케일이 크게 다른 비율은 별도 축**: 마진/ROE(한 자릿수~수십%) vs 부채비율(은행 1000%+)을 한 축에 두면 마진이 납작해짐 — 은행 105560(부채 1257%·클램핑 없이)로 "안정성 별도 차트" 결정이 옳았음을 검증. 당좌비율은 은행에서 항상 `-`→None(graceful) 정상.

## Doc updates
- CONTEXT.md promotion: none — 6지표 모두 일반 재무 용어(앱 고유 도메인 개념 아님), 글로서리 기준 미달.
- ADR added: none — 되돌리기 힘든 기술 결정 없음(기존 Naver/yfinance 추출 패턴 확장, snapshot JSON additive).
- 후속 후보:
  1. **라이브 차트 육안 검토** → forward/누적-의심 기간이 비율선에서 오해를 부르면, Naver 기간 의미 규명 + 필요시 비율선에서 해당 기간 필터(또는 is_consensus 시각 구분). Part 1 범위 밖 — 별도 백로그 후보(기존 차트도 컨센서스 기간을 표시 중이라 단독 결정 필요).
  2. **Part 2 (task#117, FCF·이자보상)** 백로그 대기 — 자기 차례 fg-ask 재그릴링(배치 cadence·무형 CapEx 포함 여부).
