# 2026-07-03 — 성능 클러스터 2of3 (task#136): 요청경로 라이브 외부호출 제거 — US 섹터 배치-백킹 + 다이제스트 시세 배치화·저장 FX

## Plan vs actual
- What went as planned:
  - 4슬라이스 전부 TDD 완료, 최종 pytest 1083 green(신규 22, 회귀 0). 배포 성공, 라이브 UAT 통과 — US 섹터 콜드 0.012s(기존 11-ETF 라이브 fan-out 수 초 → 즉답), 다이제스트 3.3s, /api/batches 27종 노출.
  - **그릴링 전 정찰이 예견한 함정 3건이 전부 무사고**: ① get_quotes_batch에 prev_close 부재 → 역산 매핑을 프롬프트에 명시, ② analysis_service↔us_sector_service 순환 import → 지연 import 지시, ③ test_scheduler_seed exact-set 단언 → 갱신 지시. 프롬프트에 박은 함정은 하나도 안 터졌다.
  - 검증 에이전트 verbatim 인용 규율(1of3 교훈) 유지 — 적대 리뷰 4건 중 반려 1건(prev_close 수식)의 판정 근거가 인용만으로 명확, 오판 0.
  - 플랜 대조 verify에 **전체 스위트 실행을 포함**시킨 것이 잔여 회귀 4건(다른 파일의 count 단언·stale mock)을 구조적으로 포착 — targeted pytest만 돌린 슬라이스 에이전트들의 사각을 메웠다.
  - 다이제스트 KR 급락 수치(-8~-12%)를 회귀로 오인하지 않고 Naver 공개 API 대조로 실장세 확인(외부데이터 증상은 라이브 프로브 선행 가토 적용).
- Divergences:
  - **배치 exact-count/exact-set 단언이 계획 인지(1파일)의 4배**: test_scheduler_seed(계획 명시) 외에 test_batch_market_split(적대 리뷰 포착)·test_batches_router·test_macro_signals_batch(verify 전체 스위트 포착)도 26 하드코딩. 기존 가토는 id *은퇴* 시 4표면 grep만 다뤄 id *추가*의 count/set 단언 표면을 안 덮었다.
  - **digest에서 yf 심볼 제거가 타 파일 테스트를 파손**: S4 완료기준 "기존 테스트 mock 이동"이 test_digest_service.py만 커버 — test_disclosure_endpoint_digest.py 2건이 `services.digest_service.yf.Ticker`를 patch → ModuleNotFoundError. 모듈에서 심볼을 제거하면 그 patch 경로를 **파일 불문 전수 grep** 해야 했다.
  - README 배치 표는 실물에 없었다(계획 S3 완료기준의 가정 오류 — kr_sector_fetch도 미등재). 아키텍처 서비스 목록에 us_sector_service만 추가로 갈음.
  - 잔여 4건은 재워크플로우 없이 메인 세션 직접 수정(eco — 소규모 마무리는 직접이 싸다).

## Learnings
- Do differently next time:
  - **모듈에서 심볼(import·함수)을 제거/개명하는 슬라이스는 `grep -rn "모듈경로.심볼" backend/tests/`를 완료기준에 포함** — mock 타깃 이동 가토의 소재지는 "그 기능의 주 테스트 파일"이 아니라 그 심볼을 patch하는 **모든** 파일이다(이번엔 공시 테스트가 digest의 yf를 patch하고 있었다).
  - **배치 id를 *추가*할 때도 count/set 단언 전수 grep**: `grep -rln "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/` — 기존 가토(id 은퇴 4표면)의 additive 사촌. 하드코딩 카운트 단언은 4파일에 흩어져 있었다.
  - 계획 완료기준이 특정 문서 구조(README 배치 표 등)를 가정하면 그릴링 정찰에서 실물 확인 — 이번엔 실행 단계에서 S3 에이전트가 스스로 발견해 무해했지만, verify가 "미충족" 오판하는 노이즈를 만들었다.
  - 유지: 그릴링 전 정찰(shape·순환·단언 함정 사전 명시), verify에 전체 스위트 실행 포함, verbatim 인용 규율.
- 후속 후보: API_SPEC "자동 배치(22종)" stale 카운트 정정(기존 stale, 이번 범위 밖 — quick감), 3of3(KR 시세 degenerate 재호출 제거, backlog 대기 중).

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음 — KR 패턴 미러라 새 결정도 없음)
- ADR added: none (가역적 미러링 — 3조건 미충족)
- CLAUDE.md Gotchas 승급(사용자 확인 대기): "심볼 제거/개명 시 patch 타깃 파일 불문 전수 grep + 배치 id 추가 시 count/set 단언 전수 grep" — 기존 '배치 id 은퇴 4표면' 가토의 additive 확장으로 1건 통합
