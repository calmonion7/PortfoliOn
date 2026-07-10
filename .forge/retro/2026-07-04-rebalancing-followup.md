# 2026-07-04 — 리밸런싱 후속 개선 (전체-포트 기준 + 타겟 삭제 + COALESCE 주석, task#147)

task#146 리밸런싱의 후속 3건(회고서 남긴 씨앗 a/b/c)을 한 태스크로 묶어 처리. 직접 처리(워크플로우 생략), 배포·라이브 UAT 통과.

## Plan vs actual
- What went as planned:
  - 3슬라이스 전부: (b) `compute_rebalance` 전체-포트 재설계(미설정 행도 실제 비중·hold, 타겟 비정규화, name 통과) · (c) PUT `Dict[str, Optional[float]]` null-삭제 · (a) `save_holdings` COALESCE eco 주석.
  - 라이브 왕복: 미설정 3종목 전체-포트 current_weight 표시(035420/000660/NFLX)·타겟 삭제(untargeted+null)·종목명·`allocation_sum`. Playwright: 000660 미설정 62.7% 표시·합계142.7% 경고·종목명 렌더.
  - 로컬 rebalance 9 + full 1110 + npm build.
- Divergences:
  - **직접 처리 시 셀프 리뷰가 워크플로우 리뷰 패스를 대체 — compute-엣지 포착**: 저장 FX가 `0`(비유한 아님이라 `_finite_float` 통과)이면 US 분기 `suggested_trade_krw / fx`에서 ZeroDivisionError. `fx <= 0`→None(no_fx) 가드 + 회귀 테스트. **원래 compute에도 잠재하던 결함**. task#146 워크플로우 리뷰가 잡은 fixture-pass(suggested_shares)와 같은 "compute 경로의 조용한 엣지" 가족 — 유닛테스트가 못 잡고 리뷰/셀프리뷰만 포착.
  - **(c)가 계획보다 작았음**: `set_target_weights`가 이미 `weight=None`→`SET target_weight=NULL`을 처리 → storage 무변경, 라우터 타입만 `Optional`로. 계획은 storage도 손댈 것으로 상정.
  - **분모 모델 변경의 파급 — 문구 전수 갱신**: 서브셋→전체-포트로 바꾸며 "합이 100이 아니어도 자동 정규화" 문구가 거짓이 됨 → 프론트 경고문·API_SPEC 설명 양쪽서 제거. (모델 의미론을 바꾸면 그걸 설명하던 UI·문서 문구를 전수 grep해야 함.)
  - **name 배선 무변경으로 충분**: GET이 이미 get_holdings(name 포함)를 compute에 넘겨, compute의 name 통과만으로 응답에 실림.

## Learnings
- Do differently next time:
  - **직접 처리(워크플로우 생략)하는 compute/파생계산 변경엔 셀프 리뷰 패스를 반드시 붙일 것.** 워크플로우면 adversarial-verify 서브에이전트가 하는 일을, 직접 처리 땐 메인이 명시적으로 해야 한다. fx=0·0-나누기·정규화 분모 같은 "조용한 엣지"는 유닛테스트(딱 떨어지는 fixture)를 통과하고 리뷰에서만 드러난다(task#146·#147 2연속). 회귀 테스트에 **경계값(0·비정수·빈 집합)**을 일부러 넣기.
  - **기존 동작을 먼저 확인하면 계획이 줄어든다**: (c)는 storage가 이미 None→NULL을 처리해 라우터 타입만으로 끝. 컬럼/저장 계층 변경을 계획에 넣기 전에 실제 코드가 이미 그 케이스를 처리하는지 grep으로 확인하면 슬라이스가 준다.
  - **계산 모델의 분모/의미를 바꾸면 그걸 설명하던 UI 문구·API_SPEC 설명을 전수 갱신**(이번 "자동 정규화" 문구). 코드만 바꾸고 설명을 두면 거짓 문서가 된다.

## Doc updates
- CONTEXT.md promotion: none — 새 도메인 용어 없음(전체-포트/드리프트/리밸런싱 모두 일반 금융용어).
- ADR added: none — 전체-포트 모델은 그릴링으로 정한 가역적 계산 정제(되돌리기 힘듦 미충족). fx=0 가드는 방어 코드(주석+테스트로 충분).
- 후속: 없음(3개 씨앗 모두 소진). no_fx 종목 비중 미표시는 여전히 문서화된 non-goal(FX 없이 KRW 환산 불가).
