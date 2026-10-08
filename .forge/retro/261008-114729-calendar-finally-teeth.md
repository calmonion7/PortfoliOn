# 2026-10-08 — Calendar 월 이펙트 .finally 가드에 이빨 (task#381, fg-loop C2 fix-forward)

## 계획 대비 실제
- 계획대로 된 것: 새로고침 버튼 비활성 단언 1줄로 `.finally` 게이트 주입이 FAIL하게 됐고 C2가 통과해 루프 목표 달성.
- 어긋난 점:
  - task#379에서 이 축을 「방어 중복이라 이빨 없음」으로 기록·봉인했는데 실제로는 **단언 누락**이었다 — `loading`을 단독으로 읽는 새로고침 버튼이 있었다. 그 오진이 정지조건 미충족 → 안전 벽 → fix-forward·재배포를 만들었다.
  - 재배포 직후 nginx 루프백 포워딩 stuck 재발(local 000·tunnel 502). 기록된 처방(즉시 stop/start)이 실패했고 stop → 리스너 소멸 확인 → ~10초 대기 → start로 회복.

## 학습
- 다음에 다르게 할 것:
  - 주입이 0 FAIL이면 「방어 중복」으로 기록하기 전에 그 상태의 소비처를 전부 열거하고, 겹친다던 방어가 가리지 않는 소비처(버튼 disabled·aria·카운트)를 단언할 것.
  - nginx 루프백 stuck은 stop과 start 사이에 간격을 둘 것.

## 문서 갱신
- CONTEXT.md 승급: 없음
- ADR 추가: 없음
- CLAUDE.md: Gotchas 무이빨 가족(task#359 항목 뒤)에 「방어 중복 판정 전 단독 소비처를 찾아라」 추가 · Deployment 절 nginx stuck 항목에 「stop → ~10초 → start」 보정
