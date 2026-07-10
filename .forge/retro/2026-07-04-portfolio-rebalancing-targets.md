# 2026-07-04 — 포트폴리오 리밸런싱 (종목별 목표 비중·드리프트·조정금액, task#146)

"데이터를 행동으로" 이데이션 → 리밸런싱 선택. Dynamic Workflow(5에이전트/eco sonnet, S1∥S2→S3→S4→리뷰), 배포·라이브 UAT 통과.

## Plan vs actual
- What went as planned:
  - 4슬라이스 전부 계획대로: `user_stocks.target_weight` 컬럼(_migrate+app_schema 쌍) · `compute_rebalance` 순수함수+회귀테스트 · `GET/PUT rebalance` 엔드포인트 · Portfolio 분석 리밸런싱 서브탭.
  - 선례 task#142(target/stop) run.md를 워크플로우에 주입한 게 유효 — Python 3.9 Optional·Decimal/float·KR 색 함정을 사전 회피(재발 0).
  - 라이브 왕복 UAT(5종목 각20%): PUT→GET rebalance 200, 드리프트·조정금액·정수 주수·합계100, 서브탭 렌더(스크린샷) 확인.
- Divergences:
  - **리뷰가 fixture-pass 실결함 포착·in-run 수정**: `compute_rebalance`의 `suggested_shares`가 `math.isclose(shares, round(shares))` 게이트라 **실거래(딱 안 나눠떨어지는 값)에선 사실상 항상 None**. fixture가 1000원×200주처럼 딱 떨어지는 값만 써서 pytest는 통과 → 전형적 CONCERNS §1(fixture-pass-live-fail). 리뷰가 `round(trade_local/price)` 항상 반환으로 수정 + 비-정수 회귀테스트 추가 + API_SPEC 정정. 라이브 UAT서 정수 주수(61/-14/3/3/130) 확인.
  - **`save_holdings`는 target_weight를 COALESCE preserve-on-null**(target_price/stop_price는 덮어쓰기와 비대칭): 일반 보유종목 수정 폼(Stock 모델)에 target_weight 필드가 없어 단순 덮어쓰기면 종목 편집 때마다 목표비중이 null 리셋(데이터 손실). `COALESCE(EXCLUDED.target_weight, 기존값)`로 보존, 강등 시엔 명시적 NULL 클리어. **미래에 "패턴 통일"하려고 덮어쓰기로 되돌리면 사용자 목표비중이 조용히 지워지니 주의** — 코드 주석 필요(후속 fg-quick).
  - **CLAUDE_COWORK_API.md 미변경**(선례 task#142 판단 재확인): doc-sync `test_cowork_api_has_no_stale_endpoints`는 "라이브에 없는 걸 문서화 말 것"만 검사하는 **부분집합 계약** → 신규 엔드포인트는 API_SPEC.md만 필수, Cowork 문서는 Cowork 분석 계약일 때만. DoD "명세서 둘 다"는 항상 둘이 아니라 사용자설정 엔드포인트는 API_SPEC.md 하나.
  - **프론트 의미론 한계**(범위 밖 판단): ① 응답에 종목명 없음 → 티커+MarketBadge만 표시. ② `current_weight`가 '타겟설정+FX확보' 서브셋 기준이라 untargeted/no_fx 행은 현재비중도 —(전체 포트 기준 아님). ③ PUT은 Dict[str,float]라 타겟 삭제(null) 미지원(0으로 낮추기만).
  - 리뷰 잔존 low 2건(무효 시세 종목 조용히 제외 — 기존 `_build_all` 관례 일치 / PUT 음수 가중치 서버 미검증 — 기존 Stock 모델도 range 미검증, 일관) — scope creep로 미수정.

## Learnings
- Do differently next time:
  - **compute/파생계산 슬라이스엔 워크플로우 내 리뷰 패스가 값을 한다** — 이번 fixture-pass 버그(suggested_shares)는 유닛테스트·빌드 다 통과하고 적대 리뷰만 잡았다. "딱 나눠떨어지는 fixture"는 나눗셈/비율/반올림 로직의 대표 맹점 — 회귀 테스트에 **일부러 안 떨어지는 값**을 넣을 것(DoD). 이 프로젝트 #1 관심사의 또 다른 인스턴스.
  - **DB NUMERIC 컬럼을 사용자 편집 폼이 *전부* 커버하지 않으면 UPSERT는 preserve-on-null**을 기본 검토 — 덮어쓰기는 폼에 없는 필드를 null 리셋한다(target_weight 실사례). target_price/stop_price가 덮어쓰기로 안전했던 건 그 둘이 편집 폼에 있기 때문. 신규 사용자설정 컬럼 추가 시 "이 필드가 어느 폼에서 세팅/미세팅되나"를 먼저 확인.
  - **doc-sync "명세서 둘 다"는 조건부** — API_SPEC.md는 모든 신규 엔드포인트 필수(존재 drift 검출), CLAUDE_COWORK_API.md는 Cowork 분석 계약 엔드포인트만. 사용자설정/내부 엔드포인트는 API_SPEC.md 하나로 충분(부분집합 계약).
  - 선례 run.md 주입이 재발 방지에 확실히 유효 — 신규 슬라이스 워크플로우 구성 시 "가장 가까운 선례"의 divergence를 CTX에 넣는 패턴 유지.

## Doc updates
- CONTEXT.md promotion: none — 리밸런싱·목표 비중·드리프트는 일반 금융용어, 앱-고유 개념 아님(글로서리 기준 미달).
- ADR added: none — COALESCE 비대칭이 "놀라움+트레이드오프"는 충족하나 "되돌리기 힘듦"이 약한 국소적 코드 결정이라 3조건 미충족. retro + 코드 주석으로 충분.
- 후속 후보(백로그 씨앗, 미결정):
  - (a) fg-quick: `save_holdings` COALESCE 비대칭에 `eco:` 코드 주석(미래 "패턴 통일" 회귀 방지). **소·저리스크, 우선 권장.**
  - (b) `current_weight`를 전체 포트폴리오 기준으로 재정의(untargeted/no_fx 행도 실제 비중 표시) + 응답에 종목명 필드 추가.
  - (c) PUT rebalance/targets 타겟 삭제 지원(현재 0으로 낮추기만).
