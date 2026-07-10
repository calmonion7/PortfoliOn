<!-- forge-slug: discovery-liquidity-filter -->
# 2026-06-18 — 발굴 저유동성 필터 (task#68)

## Plan vs actual
- What went as planned: 5슬라이스 전부 충족, TDD. Dynamic Workflow(6 에이전트, ~357k 토큰, ~6분) — 구현 병렬 4(funnel ‖ store+schema ‖ router ‖ docs, 파일 소유권 disjoint) + 통합검증 1 + 적대리뷰 1. 20일 일평균 거래대금(Close×Volume, Stage-2 기존 df 재사용·추가 호출 0)으로 `low_liquidity` 박고 **discovery read에서만 제외**(drop 아님 — 점수·저장 유지). US $1M/KR 10억, 미측정 df→True. 전체 pytest **823 passed/0 failed**(메인 세션 독립 재실행), 신규 테스트 4파일, 적대리뷰 critical/major 0(minor 2 isReal=false). 커밋 5a010e7f push→자동배포. diff 10파일/+307−17.
- Divergences:
  - **Scaffold-first를 '계약 문자열 주입 + 파일 소유권 disjoint'로 구현**(recommendation-1of4의 scaffold-edit 에이전트 방식 변형). 별도 scaffold가 공유 파일을 먼저 편집→후속 병렬 충돌하는 문제를, 공유 계약(상수명·시그니처·컬럼 DDL·row 키·param명·임계값)을 4개 병렬 에이전트 프롬프트에 주입하고 각자 disjoint 파일만 소유하게 해서 회피. 결과: **통합검증 fixes_applied=0**(계약 drift 0).
  - **`_enrich_one` 반환 shape 변경**(factors→{factors,low_liquidity} dict). 계획 S2의 함의였으나 명시 안 됨. funnel.py 내부 1곳만 소비(grep 확인, 외부 0)라 무해, 기존 batch 테스트 거짓실패 오염 0.
  - **라이브 행동 UAT는 deferred-to-post-deploy** — `low_liquidity` 기본 FALSE라 기존 저장행은 안 가려지고, 배치 재계산(admin `POST /api/recommendations/refresh?market=US` 또는 `recommendation_us` 07:00 KST 스케줄)이 선행돼야 discovery에서 CFRHF·HKHHF 부재가 관측된다.
- 검증 게이트: 5슬라이스 completion criterion 전부 충족 + 각 슬라이스 TDD 테스트 존재·통과 + 전체 823 green + 적대리뷰 clean → verified: **yes**(TDD 통과 테스트가 criteria 커버). 라이브 행동 확인은 배포+재계산 후(아래 후속).

## Learnings
- Do differently / 패턴:
  - **결합도 있는 백엔드 기능도 '계약 문자열 + disjoint 파일 소유'면 scaffold-edit 없이 병렬 가능** — recommendation-1of4는 scaffold 에이전트가 공유 파일(main/_migrate·batch_registry·scheduler)을 *먼저 편집*해 계약을 박았다. 이번엔 신규 파일/공유 와이어링이 없고 기존 5파일을 *각각 한 에이전트가 통째 소유*할 수 있어, 계약을 코드로 박는 대신 **프롬프트에 주입**하고 소유권을 disjoint로 갈라 동일 효과(통합 drift 0)를 더 싸게 얻었다. 선택 기준: 공유 파일을 여럿이 동시 편집해야 하면 scaffold-edit, 파일을 깔끔히 나눌 수 있으면 계약-주입.
  - **배치-백킹 테이블에 DEFAULT 필터 컬럼을 additive로 추가하면 라이브 효과는 '배포'가 아니라 '재계산' 시점** — 응답 shape 추가(즉시 관측, 추천 1~4파트)와 달리, `low_liquidity DEFAULT FALSE` 같은 플래그 컬럼은 기존 저장행이 default로 남아 다음 배치가 재계산해야 TRUE가 박힌다. 따라서 라이브 UAT는 배포 settle만으론 부족하고 admin refresh/스케줄 재계산을 선행시켜야 한다. (CLAUDE.md 미승격 — 기존 "배치 precompute→read" 가토와 인접하고 1회 관측, UAT 시퀀싱 뉘앙스라 retro에만. 재발하면 승격 재고.)
  - **`_enrich_one`류 내부 반환 shape 변경은 grep으로 소비처 0 확인 후 안전** — 외부 노출 없는 헬퍼라 shape를 dict로 늘려도 무해했다. 변경 전 사용처 grep이 거짓실패/오염 가드.
- 관찰(후속 후보, 차단 아님):
  - **라이브 행동 확인 미완** — 배포+`recommendation_us` 재계산 후 discovery CFRHF·HKHHF 부재 / 추적 저유동성 종목은 watchlist 노출을 라이브로 확인할 것(코드+단위는 verified yes).
  - retro 후속 큐: #69 미추적 value(컨센서스) 보강 → #70 딥다이브 exchange 정확도 → #71 holdings _latest_snapshot 배치화(backlog stub, 각 fg-ask 그릴링 대기).

## Doc updates
- CONTEXT.md promotion: none — S5에서 [[발굴 유니버스]] _Avoid_를 "필터 필요"→"저유동성은 점수·저장 유지하되 discovery에서만 제외"로 이미 갱신(새 용어 없음, 임계 수치 미유입).
- ADR added: none — ADR-0015(§1 깔때기·§2 추적종목 점수 보존·§6 섹션 요청 시 분기)의 연장. discovery-only 제외는 §2/§6이 강제한 결론이라 독립 ADR 3조건 미충족(grilling에서 확정).
- CLAUDE.md: none — 위 "배치-백킹 DEFAULT 컬럼 UAT" 뉘앙스는 retro에만(사용자 확인).
