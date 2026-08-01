# 2026-07-14 — 리서치 비교 탭 종목 선택 리스트 섹터별 그룹핑 (task#187)

fg-next all이 회고를 자동 스킵했고, **일괄 승급(2026-08-01)**에서 뒤늦게 작성했다.
원자료는 `.forge/done/2026-07-14-compare-tab-sector-grouping/run.md`.

## 계획 대비 실제

- **계획대로**: `Compare.jsx`에 순수 헬퍼 `groupCandidatesBySector` export + `SECTOR_NORM`·
  `normSector`·`OTHER_SECTOR`. 정규화→그룹→개수 desc(동수는 섹터명 A→Z)·'기타' 맨 뒤.
  기존 `auto-fill minmax(180px)` 그리드와 toggle·MAX_SELECT 로직 보존.
  vitest 79 passed(+1) · 빌드 클린 · 라이브 `/compare` UAT.
- **이탈**: 워크플로우 미사용(1파일 + 순수 헬퍼 + 테스트 1개 규모). 그 외 계획 ≈ 실제.

## 학습

- **다음에 다르게 할 것**
  1. **프론트 `SECTOR_NORM`은 백엔드 `_SECTOR_NORM`(5개 매핑)의 *수동 미러*다 — 한쪽만 바꾸면
     조용히 드리프트한다.** US `Financial Services`와 KR `Financials`를 한 그룹으로 묶는 정규화가
     양쪽에 각각 존재하고, 자동 가드(테스트·lint)가 없어 어긋나도 아무도 죽지 않는다. 증상은
     "같은 섹터인데 두 그룹으로 갈라짐" 또는 그 반대이며 화면상 오류처럼 보이지 않는다.
     → 백엔드 `_SECTOR_NORM`을 건드리는 변경은 `grep -rn "SECTOR_NORM" frontend/src/`를 함께
     돌릴 것. (`tickers.name` vs `snapshots.data.name` dual-source 가족의 상수판. 이번엔
     CLAUDE.md 승급을 보류하고 여기 남긴다 — 사용자 판단 2026-08-01.)
  2. **정렬 규칙에 tiebreaker를 명시할 것** — "개수 desc"만으로는 동수 섹터의 순서가 렌더마다
     흔들릴 수 있어 섹터명 A→Z를 2차 키로 못박았다. 목록 정렬을 새로 만들 때의 기본기.

## 문서 갱신

- CONTEXT.md 승급: 없음.
- ADR 추가: 없음 — 프론트 전용·가역.
- 가토 승급: 없음(학습 1은 사용자 판단으로 보류 — 회고에만).
