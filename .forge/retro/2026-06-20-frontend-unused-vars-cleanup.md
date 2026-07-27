# 2026-06-20 — 프론트 eslint no-unused-vars 25건 + stale eslint-disable 1건 제거

일괄 승급 회고(2026-07-28) — 학습 출처: 아카이브된 `run.md`.

## 계획 대비 실제
- 계획대로: 8파일 미사용 import 제거, 미사용 선언·파라미터·지역변수 정리, stale disable 삭제. `no-unused-vars 0`·`unused-directive 0`, 빌드 green, vitest 31 green.
- 이탈(낮음): 두 케이스를 "전체 제거"가 아니라 surgical 축소로 처리.

## 학습
- **dead-code 제거가 새 lint 위반을 연쇄로 만드는 케이스가 있다.** `const [badgeErr, setBadgeErr] = useState('')`에서 write-only 상태를 통째로 지우면 setter를 쓰던 catch가 빈 블록이 되고(`no-empty`) 잡은 err가 미사용이 된다 → **미사용 *바인딩만* 제거**(`const [, setBadgeErr] = ...`)가 무연쇄·동작동일. 마찬가지로 미사용 변수 하나를 없애려 블록을 통째 지우면 그 블록이 쓰던 다른 변수가 고아가 된다(`closestKey`는 변수·할당만 제거하고 `minDiff` 로직 보존).
- **"미사용 X 제거"의 최소 단위는 선언 한 줄이 아니라 '그 심볼을 참조하는 그래프의 잎'이다.** 지우기 전에 "이걸 지우면 무엇이 고아가 되는가"를 한 번 되짚을 것.
- 행동·시각 무변경 정리는 eslint 카운트 0 + 빌드 + vitest + 주의케이스 코드대조로 검증이 충족되고 라이브 스모크는 가치가 낮다(task#85 선례와 동일 판단).

## 문서 갱신
- 승급 없음 — 프론트 정리 작업 한정 절차 교훈으로 retro에 보존.
