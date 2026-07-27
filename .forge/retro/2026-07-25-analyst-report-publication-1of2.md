# 2026-07-25 — 애널리스트 리포트 발행 파이프라인 백엔드 (part 1/2)

일괄 승급 회고(2026-07-28) — 학습 출처: 아카이브된 `run.md`.

## 계획 대비 실제
- 계획대로: `analyst_reports` 테이블(schema+`_migrate` 쌍), `per_band()`, 발행 POST(admin/api-key, Pydantic v2 검증, 스냅샷 발췌 박제), 조회 3종, 문서 2종. 전체 1313 passed.
- 이탈 7건 중 큰 것: 워크플로우 생략(직렬 의존), **적대 리뷰 BLOCKER 1건 in-run 수정**, 그 연쇄로 `main.py` 전역 핸들러 추가, date 파싱 가드, Pydantic v1→v2 문법 정정.

## 학습
- **입력 경로의 NaN은 3중으로 통과한다** — ① `json.loads`는 `NaN` 토큰을 허용, ② Pydantic v2 float 필드는 기본 `allow_inf_nan=True`, ③ `low <= high` 같은 비교 검증은 NaN에서 **항상 False**라 조건을 뒤집어도 안 걸린다. 결과: 불변이어야 할 발행 문서에 NaN이 조용히 저장됐다(리뷰어가 라이브 재현). **float 필드는 `allow_inf_nan=False`를 명시**하고, 범위 검증은 NaN을 먼저 배제할 것.
- **NaN을 거부하면 이번엔 422가 500이 된다** — FastAPI 기본 검증 에러 응답이 입력 NaN을 그대로 echo하고 starlette는 `allow_nan=False`라 직렬화에서 터진다 → `RequestValidationError` 커스텀 핸들러 + sanitize가 필요하다. 이건 이 엔드포인트만의 문제가 아니라 **앱 전역**이라 main.py에서 한 번 막는 게 맞았다(계획 밖 변경이었지만 정당).
- 로컬 pydantic 버전을 먼저 확인할 것(v1 문법으로 작성 후 v2로 정정하는 왕복이 있었다).
- 무페이지네이션은 의도적 YAGNI로 남겼다(선별 종목 전용) — 트래픽이 생기면 LIMIT 추가.

## 문서 갱신
- **CLAUDE.md Gotchas 승급**: 입력 경로 NaN 3중 통과 + 422 echo 500(사용자 승인, 일괄 승급 2026-07-28).
