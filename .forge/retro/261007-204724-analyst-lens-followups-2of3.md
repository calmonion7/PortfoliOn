# 2026-10-07 — 심층 리포트 렌즈 후속 2/3: 화면 (일괄 승급)

## 계획 대비 실제
- 계획대로 된 것: 일반인 렌즈 이름(`LENS_INFO` 단일 소스) + 두 위치 「?」(기존 `GlossaryTerm` 팝오버 재사용), 애널 추정치·비교 기간·경계 근접 표시, 옛 판 허용. vitest 53→60, 라이브 uat369 배포 전 FAIL 30(red-first) → 배포 후 142/142.
- 어긋난 것:
  - **첫 `deploy.sh`가 옛 트리로 빌드됐다.** push 직후 폴러가 낡은 `origin/main`으로 reset한 순간에 배포가 돌았다(reflog `reset: moving to origin/main`, dist 새 문자열 0건). `git merge --ff-only origin/main` 후 재배포. 러너 offline으로 `deploy.sh`를 손으로 돌리는 기간이라 재현되기 쉽다.
  - `GlossaryTerm`이 className·aria-label을 못 받아 선택 prop 2개 추가. 신호 행 이름이 `<a>` 안이라 「?」를 형제로 분리.
  - 계획 미지목 결함: 원자료 출처 배지가 2분기라 `consensus`가 「공시」로 오표시될 자리 → 3분기.
  - 내 테스트의 옛 이름 부재 단언 리터럴이 C5 grep에 걸렸다 — 루트 가토(task#339 감사 리터럴)의 *테스트 파일판*. 리터럴을 잇대어 만들어 해결.

## 배움
- 다음엔 다르게: 배포 직전 `HEAD == origin/main` 확인, 배포 뒤 dist에서 바꾼 문자열 grep. 배포 성공 표시는 *무엇이* 배포됐는지 말하지 않는다.
- 부재를 단언하는 테스트는 그 리터럴을 직접 적지 않는다(감사 grep이 테스트 자신을 센다).

## 문서 갱신
- CONTEXT.md 승급: 없음
- ADR 추가: 없음
- 루트 CLAUDE.md 가토: 「푸시 직후 deploy.sh가 옛 트리로 빌드될 수 있다」 신설

## 후속 후보
- `deploy.sh`가 빌드 전에 `HEAD == origin/main`을 스스로 확인하고 어긋나면 중단(또는 ff) — 구조적 대책. 착수는 fg-ask로.
