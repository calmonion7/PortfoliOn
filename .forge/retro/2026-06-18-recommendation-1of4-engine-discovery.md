<!-- forge-slug: recommendation-1of4-engine-discovery -->
# 2026-06-18 — 추천 엔진 + 발굴 백엔드 (task#64, part 1/4)

## Plan vs actual
- What went as planned: 6 슬라이스 전부 구현·TDD. Dynamic Workflow(8 에이전트, ~660k 토큰) — Scaffold-first + 병렬 웨이브(Logic/Integrate/Wiring) + 적대적 리뷰. 신규 단위테스트 45, 전체 781 passed, 회귀 0, 리뷰 findings 0. 변경 수술적(services/recommendation/ 패키지·routers/recommendations.py·테스트6 신규 + app_schema·main·scheduler·batch_registry·API_SPEC + 공유 배치테스트4 카운트 22→24). 커밋 04c43b7c push → 배포 success → 라이브 `GET /api/recommendations` 발굴 50건(KR·US, 점수순, 정량 플래그) 반환.
- Divergences:
  - **라이브 완료기준은 deferred-to-live-uat**였다 — S3 "배치 실행→테이블 채움"·S5 job_runs 실기록·S4 DB upsert/read는 외부 API·키·DB가 필요해 워크플로우에서 못 돌림. 코드+단위테스트(monkeypatch)로만 충족하고, 실제 채움·반환은 배포 후 UAT에서 확인(통과).
  - **S5 작업 재배분** — Scaffold가 scheduler 래퍼·_JOB_FUNCS·batch_registry를 이미 완성해, S5는 코드 무변경·정합 확인+테스트만 추가.
  - 공유 배치-카운트 테스트 4파일 갱신(배치 2개 추가 부수효과).
- 라이브 UAT: 테스트 계정(test@portfolion.com) 로그인 API → `GET /api/recommendations` HTTP 200, as_of 2026-06-17, discovery 50건. 직접 검증.

## Learnings
- Do differently next time:
  - **Scaffold-first가 병렬 워크플로우의 계약 일관성을 보장한다** — 인터페이스 시그니처·응답 shape·DDL·factors/score dict를 *먼저* 한 에이전트가 박제하고 공유 파일(main/_migrate·include_router·batch_registry·scheduler)을 그 한 번에 편집하니, 후속 병렬 에이전트가 disjoint 파일만 채워 시그니처 mismatch·머지 충돌 0(리뷰 계약 findings 0). 결합도 높은 백엔드 기능을 fan-out할 때 재사용.
  - **배치-백킹 기능은 "코드+단위(워크플로우) / 라이브(배포 후)"로 검증을 쪼갠다** — 외부 API·키·DB가 필요한 완료기준은 워크플로우에서 deferred-to-live-uat로 명시하고 monkeypatch로 SQL·와이어링만 단언, 실제 채움은 배포 후 확인. 라이브 UAT는 **테스트 계정 로그인 API curl**로 무UI 단계에서도 가능(`reference-frontend-uat`의 Playwright를 순수 API로 확장 — 토큰 받아 엔드포인트 직접 호출).
  - **라이브 데이터가 fixture에 없던 케이스를 드러낸다(또 한 번)** — 발굴 상위에 저유동성 OTC/외국 티커(CFRHF·HKHHF, 거래량 11.6배)가 구루(13F) 유니버스+거래량 급증으로 새어 올라옴. 단위테스트는 못 잡고 배포 후 라이브 호출이 잡음. 수주잔고 재적재 교훈과 동일 클래스.
- 관찰(튜닝/후속 후보, 차단 아님):
  - **value 팩터 결측 편향** — 미추적 발굴 종목엔 컨센서스/목표가가 없어 점수가 모멘텀·거래량·구루로 쏠리고 상위권 다수가 `목표가 데이터 부족` 플래그. ADR-0015 graceful degrade대로지만 발굴 품질이 모멘텀 편향. 완화책: 미추적 후보에 컨센서스 싸게 보강하는 경로, 또는 결측 신뢰도 표시.
  - **저유동성 OTC 혼입** — 위 라이브 관찰. 유동성/주거래소 필터 필요.
- 검증 게이트: 45 TDD 테스트 + 적대적 리뷰 0건 + 메인 세션 독립 재실행 781 passed + 배포 success + 라이브 발굴 50건 반환으로 verified: yes. 커밋 04c43b7c.

## Doc updates
- CONTEXT.md promotion: **[[발굴 유니버스]] _Avoid_에 한 줄 추가** — "구루 유니버스 = 우량주만" 오해 방지(US 13F의 저유동성 OTC 혼입·유동성 필터 필요, CFRHF·HKHHF 사례).
- ADR added: none (라이브 관찰 2건은 가역적 튜닝이고, funnel/graceful 경계는 ADR-0015가 이미 커버 — ADR 3조건 미충족).
- CLAUDE.md: none (Scaffold-first·deferred-uat는 forge 워크플로우 운영 노하우라 회고에만; 프로젝트 코드 함정 아님).
- 후속 후보(파트와 별개 튜닝 task 가능): ① 발굴 유동성/주거래소 필터 ② 미추적 후보 value(컨센서스) 보강 또는 결측 신뢰도 표시.
