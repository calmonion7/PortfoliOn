<!-- forge-slug: rec-card-guru-holders -->
# 2026-07-03 — 추천 카드 구루 보유 개수 노출 (task#139)

## Plan vs actual
- **계획대로**: 프론트-only 3슬라이스 전부 계획대로. `Recommendations.jsx`에 `/api/guru/managers` top10 역인덱스(`buildGuruCounts`) 1회 fetch(graceful)·`guruCounts` state·`guruCountFor` lookup·3섹션 RecCard에 `guruCount` 주입; `RecCard`가 "구루 신규 매수" 칩을 count≥1이면 "구루 N명 보유"로 제자리 교체(동일 초록·슬롯), 미보유·KR·실패·미로딩 원본 graceful. 백엔드 0변경. vitest 15 green(신규 5)·`npm run build` green·main 67edecb 푸시.
- **Divergences (3건 전부 의도적)**:
  - **D1** Dynamic Workflow 대신 **직접 실행** — 프론트-only 소형·순차 3슬라이스라 병렬화 이득 0 + eco(스킬 Constraints 준수).
  - **D2** 플랜의 "**양쪽에** 상호 참조 주석" 중 **백엔드(scoring.py) 주석 생략** — 강조된 "백엔드 0변경"을 문자 그대로 지킴(코멘트라도 backend diff 회피). 트레이드오프: 백엔드에서 라벨 rename하는 개발자가 결합을 못 볼 soft 리스크(실패는 graceful — 개수 없이 원본 라벨 표시).
  - **D3** 코드↔글로서리 드리프트는 그릴링서 이미 포착·계획 명시분 재확인(신규 아님).

## Learnings
- **Do differently next time**:
  - **fg-ask 후속-큐 스캔이 *봉인된* task를 "미완 후속"으로 오보할 수 있다 — "후속 후보"는 `.forge/done/*/STATUS.md`로 대조 후 수용.** 이번 그릴링서 스캔이 task#124 3/3(구루 드릴다운)을 미완 후속으로 플래그했으나 실제론 2026-06-30 봉인 완료(retro skip)였다 — done/ STATUS 확인으로 포착해 방향을 "리포트 상세 드릴다운"→"추천 카드 개수 노출"로 재조정. retro/스캔은 *참조*일 뿐 source of truth 아님(스킬 원칙 그대로) — 봉인 여부는 done/ 마커로 확정할 것.
  - **코드↔글로서리 드리프트는 표시 레이어에서 저비용으로 교정 가능.** `guru_new_buy`·"구루 신규 매수"(실제론 top10 보유 멤버십)가 CONTEXT의 "구루 보유"와 어긋나는데, 백엔드 rename(테스트·재계산 파급) 대신 프론트 라벨 교체로 카드를 글로서리에 맞췄다. 단 **프론트가 백엔드 라벨 문자열에 결합**되므로(RecCard 매처) 후속 백엔드 rename 시 매처 동시 갱신 필요 — 양쪽 주석 결합이 이상이나 이번엔 "백엔드 0변경" 우선(D2).
  - (경미) 소형 프론트-only는 워크플로우보다 직접 실행이 싸고 빠름(eco) — 스킬 Constraints가 이미 명시.

## Doc updates
- CONTEXT.md promotion: none (용어집이 이미 "구루 보유"로 올바름 — 드리프트는 코드 쪽이라 글로서리 무변경).
- ADR added: none (프론트 표시·되돌리기 쉬움·기존 task#124 프론트-only 패턴 답습, 3조건 미충족).
- **후속 후보(미해결)**: ① 백엔드 라벨/변수 정정(`guru_new_buy`→`guru_member`, "구루 신규 매수"→"구루 보유") + 프론트 매처 동시 갱신 — 드리프트 근본 해소. ② 진짜 구루 활동(분기 신규매수/증가/축소, dataroma 히스토리) — 별개 큰 작업, 데이터 리스크.
