# 2026-07-23 — 리포트 심층분석 본질가치 재구성 1/2 (데이터층: 경쟁축·시장전망·R&D 집약도)

일괄 승급 회고(2026-07-28) — 학습 출처: 아카이브된 `run.md`.

## 계획 대비 실제
- 계획대로: enrich 2필드 6계층 배선(schema+`_migrate` 쌍 포함), `rd_intensity`를 기존 ThreadPool 루프 편승으로 추가, Cowork 문서 9업종 표 확장. pytest 1297 passed(신규 20).
- 이탈: 적대 리뷰 must-fix 1건 in-run 수정 + nice-to-have 1건 후속 이월.

## 학습
- **신규 외부호출 함수를 기존 경로에 끼우면, 그 경로의 테스트가 그 함수를 모킹하지 않아 라이브 API에 도달할 수 있다.** 이번엔 KR `generate_report` 테스트의 `_mock_kr()`이 신규 `get_rd_intensity_kr`을 안 막아 **테스트가 실제 DART로 나갈 수 있었고, 로컬 `DART_API_KEY` 부재로만 조용했다**(키가 있는 환경에선 실호출). 외부호출을 추가하면 **그 함수를 타는 기존 테스트의 mock 세트를 전수 갱신**할 것 — conftest `_block_real_db`가 DB만 막는다는 점도 함께 기억.
- **공유 외부 쿼터(DART)를 쓰는 신규 호출은 기존 형제의 throttle 관례를 따라야 한다.** `get_rd_intensity_kr`은 경쟁사당 최대 4콜을 무스로틀로 8워커 동시 실행해 `backlog.py`/`agm.py`의 0.3s polite throttle과 비대칭이 됐다(실패는 graceful None이라 기능 파손은 아니나 쿼터 리스크). 외부 API 신규 호출 슬라이스의 체크리스트에 "형제 모듈의 throttle 관례 확인"을 넣을 것.

## 문서 갱신
- 승급 없음 — DART/외부호출 세부는 CLAUDE.md 해당 절이 이미 다루고, 이번 교훈은 절차(mock 전수·throttle 대칭)라 retro에 보존.
