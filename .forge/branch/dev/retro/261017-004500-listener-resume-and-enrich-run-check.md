# 2026-10-17 — fire 리스너 재기동 이어받기 + enrich 회차 완료 데이터 대조 스크립트 (task#390, 일괄 승급)

## Plan vs actual
- What went as planned: S1~S4 전부. 빨간불 8건 → 리스너 30 passed, 전체 2568 passed(기준 2558), B1 라이브 `22/22` exit 0, 문서 해당없음 확인.
- Divergences:
  - **S5(PR)는 실행하지 않았다.** fg-loop 계약의 허용 범위에는 「PR 생성까지」를 넣었지만 정지조건 C1~C5에 PR 체크가 없어, S5 없이도 목표 달성으로 종료됐다. 실제로 `dev` push는 dev 스택 배포라 확인 없이 할 수 없는 외부 행위였다.
  - 상태 파일은 하나라 큐에서 대기 중인 뒤 회차는 이어받기 대상이 아니다(docstring에 명시).

## Learnings
- Do differently next time:
  - fg-loop 계약을 맺을 때 허용 범위에 **외부 행위(push·배포·PR)를 수반하는 슬라이스**를 넣으면, 그 슬라이스를 체크로 만들거나(예: `gh pr view` 존재) 범위에서 빼고 사람 몫으로 명시할 것. 체크에 없는 슬라이스는 안 해도 루프가 닫힌다.
  - 이어받기의 알려진 한계 2가지(spawn↔pid 기록 사이 끊김 시 청크 1개 중복 실행 / 대기 중인 뒤 회차는 재기동 시 소실)는 docstring에만 있다. 두 번째가 실제로 문제가 되면 후속 작업(상태 파일 다중화 또는 큐 영속화)을 연다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none
