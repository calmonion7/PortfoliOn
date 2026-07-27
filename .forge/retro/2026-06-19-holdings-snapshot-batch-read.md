# 2026-06-19 — 보유 액션 _latest_snapshot N회 직렬 read 배치화

일괄 승급 회고(2026-07-28) — 학습 출처: 아카이브된 `run.md`.

## 계획 대비 실제
- 계획대로: `_latest_snapshots(tickers)` 배치 read 1회 + 누락 티커 per-ticker 폴백, TDD red→green, 전체 835 passed.
- 이탈: ① 계획의 완료기준 "`_latest_snapshot` 0회 call_count 단언"은 **import를 지우면 patch 대상 속성 자체가 사라져** 단언 불가 → `_latest_snapshots.call_count == 1` + 인자=보유 전체로 의도를 대체 표현. ② 기존 mock patch 10곳을 기계적으로 마이그레이션.

## 학습
- **단건→배치로 줄이는 변경은 CLAUDE.md "additive read가 mock.call_args를 오염시킨다" 가토의 역방향**이다 — 호출 시퀀스가 N→1로 *줄어들기* 때문에 상위 엔드포인트의 호출 순서는 불변이고, 대신 **그 함수를 patch하던 모든 테스트가 시그니처/반환형 변경으로 깨진다.** 배치화 착수 전에 `grep -rn "<모듈>.<심볼>" backend/tests/`로 patch 지점을 먼저 세고, `side_effect=lambda t: ...` → `return_value=<dict>` 같은 변환 규칙을 미리 정해두면 마이그레이션이 기계적으로 끝난다.
- **"호출 0회"를 완료기준으로 쓰지 말 것** — 그 심볼의 import를 제거하는 게 정답인 변경에서는 단언 대상이 소멸해 기준이 자기모순이 된다. "신규 함수 1회 + 인자 전체"처럼 *존재하는 것*을 단언할 것.

## 문서 갱신
- 승급 없음 — CLAUDE.md의 additive-mock 가토가 이미 같은 가족을 다루므로 그 역방향 사례로 retro에 보존.
