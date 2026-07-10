# 추천 스코어 결측군 중립 채움 — 근거 완전성 보상 (ADR-0015 graceful-degrade 합성 대체)

> Status: accepted. ADR-0015 Consequences의 "미추적 종목은 가용 팩터만으로 graceful degrade(결측군 재정규화)" 합성 부분을 **supersede**한다. ADR-0015의 나머지(2단 깔때기 §1·점진 유니버스 §2·정량 플래그 §3·딥다이브 §4·precompute→read §5·per-user partition §6)는 불변.

## Context

ADR-0015 §3에 따라 [[추천]] 점수는 value(목표가 상승여력)·momentum·smart_money 3군을 투명 가중(0.35/0.35/0.30)으로 0~100 합성한다. 결측군 처리는 0015 Consequences에 "가용 팩터만으로 점수(graceful degrade)"로 박혀 있고, 구현(`scoring.score_stock`)은 **결측군의 가중치를 분모(denom)에서 빼고 가용군만으로 재정규화**했다.

그 결과 미추적 발굴 종목 — 컨센서스(value)·KR 수급/지분공시(smart_money)가 결측이라 **모멘텀만 가용** — 이 모멘텀 단일 축으로 100점까지 도달해 발굴 상위를 점령하고 "목표가 데이터 부족" 플래그를 단 채 모멘텀 편향을 일으켰다(retro `recommendation-1of4-engine-discovery` 관찰, task#69).

## Decision

결측군을 분모에서 제외하지 않고 **중립값(`_NEUTRAL`=0.5)으로 채운다** — `denom`은 항상 전 가중치 합(1.0). 따라서:

- **단일 군만 present인 종목은 중립으로 끌려와 ≤67.5점**(단일 축 만점 불가). 전군 결측 = 50(불변).
- **근거가 여러 군에서 합치할수록 높은 점수 = 근거 완전성 보상.** 모멘텀이 같은 두 종목 중 value·smart_money까지 양(+)으로 present인 종목이 결측 종목보다 점수가 높다.
- 결측 표시(missing 플래그, `derive_flags`)는 그대로 유지 — 점수 합성만 바뀌고 플래그 구조·응답 shape는 불변.

발굴은 KR/US **통합 단일 리스트**(`store.read_recommendations` `ORDER BY score DESC`, 시장 분리 없음)를 유지한다(ADR-0015 §6 per-user partition 불변).

## Why / Trade-off

- **재정규화의 함정**: 결측을 "없던 일"로 취급해 1개 축 만점을 허용하면, 데이터가 얇은 종목이 데이터 풍부한 종목과 *동일 천장*에서 경쟁한다. 중립 채움은 "근거 빈약 = 중립 수렴"이라 발굴 상위가 다축 합치 종목으로 정렬된다('wrong < missing'의 점수판 — ADR-0014 플래그 투명성 원칙의 연장).
- **거부한 대안 ① 외부 컨센서스 보강**: 미추적 후보에 라이브 목표가를 fetch하면 데이터 질은 최선이나 **ADR-0015 §1 깔때기 비용 한도(요청·기동·배치 외부호출 최소화)와 정면 충돌**하고 task#69 Non-goal(전 종목 컨센서스 백필 아님)을 넘는다. 중립 채움은 외부호출 0·순수 로직.
- **거부한 대안 ② 결측 신뢰도 표시만**: 결측은 이미 missing 플래그로 노출 중이고, 표시만으론 **랭킹을 안 고쳐** 모멘텀 편향 자체가 남는다.

## Consequences

- **KR 쏠림(수용)**: 통합 단일 리스트라, guru(US 전용 §3 Consequences)·KR 수급(추적 위주)이 흔히 결측인 미추적 KR은 ~64에서 상한 → 발굴 상위가 guru-backed US로 쏠린다. 이는 "근거가 많이 합치하는 종목이 위"의 정직한 반영으로 수용한다(시장별 상위 분리는 응답 reshape+프론트 전수 grep+§6 개정이 필요해 별도 task로 분리).
- **라이브 반영은 배포가 아니라 재계산 시점**: 점수 분포 이동은 `recommendation_kr`(20:30)/`recommendation_us`(07:00) 또는 admin `POST /api/recommendations/refresh`가 재계산해야 저장행에 박힌다(저유동성 필터 task#68과 동일 클래스 — 배치-precompute 가토).
- **회귀 가드**: graceful-degrade로 되돌리면 모멘텀 편향이 재발한다. `test_recommendation_scoring`의 완전성 단조성·단일군 상한(≤67.5) 불변식 테스트가 이를 못박는다(구 `test_renormalization_consistent`는 reversed semantics라 재작성).
