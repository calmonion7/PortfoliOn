# 2026-07-12 — 업종별 핵심 자원(key_resource) enrich 필드 + 코워크 가이드 업종 규칙 (task #183)

## Plan vs actual

- What went as planned: S1~S3 전부 MET. 6계층 배선(schema+_migrate 쌍·Pydantic·storage·report summary 2곳)·`KeyResourceSection`(심층분석 탭 moat 옆)·문서 3종(COWORK 가이드 5버킷 업종 표+인력 완전명세·API_SPEC·README). pytest 1277·vitest 72·빌드 green, 적대적 리뷰 must-fix 0. 배포 `0cff9c1` → 기동 `_migrate()`가 컬럼 자동 적용(insights 때의 수동 psql 불요 — 계획 검토 메모가 예측한 그대로). UAT: BAH 라이브 스크린샷으로 섹션 렌더 확인.
- Divergences (경미):
  - `save_stocks`/`save_holdings` tickers INSERT에 key_resource 의도적 미추가 — insights도 원래 없는 기존 비대칭(enrich 필드 쓰기는 `enrich_stock` 전용). `get_stocks`는 `_ANALYST_KEYS` 제네릭 순회라 집합 추가만으로 자동 포함.
  - S2 vitest 신규 테스트 스킵(섹션 컴포넌트 테스트 선례 부재 — 계획이 조건부로 허용).
  - S1 라이브 스모크는 배포 종속이라 UAT로 이월, UAT에서 완결.
  - UAT 데이터측 피드백 2건(1인당 영업이익 누락·series 2분기뿐) → 가이드 강화 `7dabf7e`로 in-run 조치(3지표 필수·최근 4분기 이상·예시 3지표×4분기·US 단위 허용).

## Learnings

- Do differently next time:
  - **코워크 스킬 박제본 드리프트 — additive enrich 필드는 서버 배포만으론 안 온다**: 외부 Cowork 클라이언트의 스킬에 enrich 필드 목록이 박제돼 있어, 가이드(`CLAUDE_COWORK_API.md`)를 갱신해도 코워크가 스킬 사본을 갱신하기 전까지 신규 필드를 **조용히 누락**한다(1차 enrich에서 실증: 기존 필드 전부 채워지고 key_resource만 null — 백엔드 거부가 아니라 미전송). 신규 enrich 필드 슬라이스의 완결엔 "코워크 스킬 사본 갱신 + 1종목 재-enrich 확인"이 포함돼야 한다.
  - **AI 소비 문서의 예시 JSON은 산문 규칙보다 강한 앵커**: 가이드 예시 series가 단일 분기였더니 코워크가 2분기만 채움(3지표 나열 산문은 있었는데 1개 지표 누락도 발생). 요구 최소 형태(3지표×4분기)를 예시 자체가 시연하도록 작성하고, 하한("최근 4분기 이상")은 필드 표에 명문화할 것.
  - **크레덴셜 없는 파이프라인 진단 경로**: 공개 `GET /api/report/{ticker}/{date}`의 `enriched_at`(라이브)·summary 키 존재/값 + `GET /api/report/progress`(done/total) 조합으로 enrich 도착→필드 포함→재생성 완료를 단계별 분리 판정 가능 — "enrich는 왔고 필드만 빠짐"을 추측 없이 특정했다. 외부 클라이언트 연동 디버깅에 재사용.
  - insights 선례 미러링 + "grep 패리티 확인을 에이전트 지시에 명시"가 6계층 배선을 리뷰 must-fix 0으로 통과시킴 — 다층 배선 슬라이스의 유효 패턴(배선 누락 가토 예방을 지시 단계에서).

## Doc updates

- CONTEXT.md promotion: none (핵심 자원 용어는 fg-ask 단계에서 이미 등록).
- ADR added: none (비가역·의아함·트레이드오프 3조건 충족 결정 없음).
- 후속 후보: ① 코워크 재-enrich(3지표×4분기) 후 화면 재확인, ② 핵심자원 metrics 차트 렌더(계획 비목표로 이월), ③ 5버킷 외 업종(금융·소비재) 규칙 확장.
