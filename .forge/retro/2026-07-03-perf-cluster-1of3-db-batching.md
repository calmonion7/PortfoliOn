# 2026-07-03 — 성능 클러스터 1of3: DB 배치화 (task#135): execute_many + N+1/행별 execute 8곳 제거

## Plan vs actual
- What went as planned:
  - 7슬라이스 전부 TDD 완료(계획 완료기준 충족). pytest 1031→1061 green(신규 30, 회귀 0), 배포 성공, 라이브 스모크 `/api/report/list` 200·0.39s·컨센서스 23/25 정상.
  - **mock 타깃 이동 가토를 계획에 명시한 것이 효과** — 각 에이전트가 변경 함수로 tests 전수 grep, 5개 파일 patch 타깃 마이그레이션, verify의 stale-mock grep 0. quote-fetch-perf(06-13) 회고 교훈의 재사용 성공.
  - 파일충돌(S4·S7=insider_trades.py)은 그릴링 단계 파일맵 분석으로 에이전트 병합 — 충돌 0.
- Divergences:
  - **fixture-pass-live-fail SQL 2건이 배포 직전에야 포착**: ① `uuid = ANY(text[])` 타입 오류(적대 리뷰 적발), ② `_values_placeholder` VALUES 이중 괄호 → record 1행화 = list_reports 전파손(워크플로우 verify·적대 리뷰 **둘 다 놓침**, 메인 세션 직독 포착). 둘 다 pytest green 상태의 배포-즉사 버그.
  - 적대 리뷰 major 2건 in-run 반영(공유 neutral dict 참조 → 티커별 새 dict, 입력 중복 쌍 dedupe).
  - minor 2건 의도적 미조치: 공시 배치 글로벌 ORDER BY+Python 상한(플랜 명시 허용 — 데이터 커지면 window function), Portfolio.jsx 에러카드 게이트(#134 재론 — **직전 리뷰와 정반대 지적**이라 churn 방지).

## Learnings
- Do differently next time:
  - **SQL을 새로 짜거나 단건→배치로 개작하는 슬라이스는 "라이브 스모크 DoD"를 계획 단계에 명시** — query-mock 테스트는 SQL 문법·타입 정합을 전혀 못 본다. 이번엔 우연히(적대 리뷰 + 메인 직독) 잡았지만 구조적 게이트가 아니었다. → CLAUDE.md 가토 승급(아래).
  - **워크플로우 verify 에이전트는 "diff가 계획과 일치하는가"만 보고 SQL 자체를 실행/조립 검증하지 않는다** — 신규 SQL이 있는 런은 메인 세션이 그 SQL을 직접 read해 조립 형태를 눈검증하는 습관이 유효했다(VALUES 건 포착 경로). 적대 리뷰 프롬프트에 "SQL을 실제 문자열로 조립해 문법 검증" 렌즈를 넣는 것도 방법.
  - **연속 리뷰어가 정반대 방향을 지적할 수 있다**(#134 리뷰 "ref+error AND는 레이스" ↔ #135 리뷰 "error AND 게이트 필요") — 리뷰 지적은 자동 반영이 아니라 이전 결정 맥락과 대조 후 채택. 이번엔 직전 결정 유지(churn 방지)가 옳았다.
  - 검증 에이전트에게 **"항목별 현행 코드 verbatim 인용 + 인용만으로 판정" 규율을 부과하면 오판이 사라진다** — 견고성 그릴링(FIXED 오판 5건) 대비 이번 성능 그릴링(오판 0)의 차이.
- 후속 후보: 공시 배치 조회 window function 전환(데이터 증가 시), admin 사용자 목록 라이브 스팟체크(uuid 캐스트 — admin 계정 필요).

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (전부 가역적 — 3조건 미충족)
- **CLAUDE.md Gotchas 승급 1건**: "신규/개작 SQL은 query-mock이 못 잡는다 — ANY 배열화 uuid 캐스트·VALUES 이중 괄호 함정 + 라이브 스모크 DoD" (fixture-pass-live-fail 가족의 SQL판)
