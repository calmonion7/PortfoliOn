<!-- forge-slug: guru-list-sort-and-back-pill -->
# 2026-07-28 — 구루 목록 기본정렬 규모↓ + 구루 상세 좌하단 목록복귀 pill (task#228)

일괄 승급으로 사후 작성(봉인 2026-07-28, `fg-next all` 드라이브가 회고를 자동 skip한 분).

## Plan vs actual
- **계획대로**: 프론트-only 3슬라이스 전부. `GuruManagers.jsx` 정렬 기본값 규모 내림차순 + `SORT_OPTIONS` 첫 항목 이동(PC·모바일 공유 배열이라 1곳), `mobile.css` `.list-pill--left` 2줄, `GuruDetail.jsx` PC·모바일 정상 본문에 `← 목록` pill(상단 링크 유지·에러 상태 미추가). 백엔드 0변경. vitest 141 green(신규 2)·`npm run build` green·라이브 UAT 11/11 ALL PASS·main `080b5ed` 푸시.
- **Divergences**:
  - **D1** Dynamic Workflow 대신 **직접 실행**(의도적) — JS 3줄·CSS 2줄·JSX 2줄·테스트 2건이라 병렬화 이득 0. fg-run Constraints + eco. task#139 retro D1과 동일 판단이 재확인됨(소형 프론트-only의 기본 경로로 굳어도 될 정도).
  - **D2** 기본값을 리터럴 대신 `SORT_OPTIONS[0]`에서 **파생**(계획 초과, 값 동일) — 칩 순서를 또 바꿀 때 기본값이 첫 칩과 어긋나는 드리프트를 구조적으로 봉쇄. "기본 정렬 = 첫 칩"이 코드에 불변식으로 드러난다.
  - **D3** ⚠️ **UAT 프로브가 토스트 영역을 추정해 거짓 FAIL** — 아래 Learnings 참조. 승급됨.
  - **D4** 부수 발견(미수정): 이론적 최대폭(280px) 토스트는 좌·우 pill **양쪽과 대칭으로 ~30px** 겹친다 → 좌측 이동이 만든 신규 리스크가 아니라 `.list-pill` 레이어의 기존 성질. `pointerEvents:none`이라 탭 차단은 없고 3초 후 소멸이라 surgical 원칙상 손대지 않음.
  - **D5** 관찰(미수정): 모바일 `GuruDetail` appbar 제목이 스크롤 콘텐츠와 겹쳐 보인다(`screenshots-uat228/m-detail-bottom.png`). task#228 이전부터의 아티팩트로 범위 밖.

## Learnings
- **Do differently next time**:
  - **라이브 프로브가 비교하는 *기준 상자*도 실측 대상이다 — 규약을 프로덕션 코드에만 적용하면 검증 도구에서 어기게 된다.** task#225 가토("레이아웃 수치 추정 금지")를 이번엔 프로덕션이 아니라 **UAT 프로브**에서 위반했다: 토스트 충돌 판정 영역을 "중앙 ±130px"로 가정 → 좌측 pill(`r=88`)과 21px 교차 → FAIL. `Toast.jsx` 스타일을 재현한 노드를 심어 실측하니 실제 박스는 `l=98·r=295`(폭 197)로 **교차 0**(여유 10px)이었다. 거짓 FAIL을 그대로 받아들였다면 정상 구현을 되돌렸을 것 — **가정으로 만든 게이트는 구현만큼 위험하다.** 대응: 프로브의 상대 좌표도 `getBoundingClientRect()`로 얻거나 실제 스타일 재현으로 측정하고, 판정은 리터럴이 아니라 불변식(교차 0·응답 순서 일치)으로 쓸 것. → CLAUDE.md task#225 가토 ③으로 승급.
  - **`fg-next all` 드라이브의 회고 자동 skip은 "학습이 없다"가 아니라 "나중에 승급"이다 — 실제로 이번엔 승급할 게 있었다.** 드라이브가 봉인까지 밀어붙인 뒤 사용자가 "회고"를 요청해 D3가 건져졌다. 소형 UI 작업이라 `retro-hint: optional`을 달았던 판단 자체는 옳았지만(계획 대비 실질 일치), **UAT 단계에서 자기 도구의 결함을 발견한 런은 divergence가 낮아도 승급 후보가 생긴다** — retro-hint는 계획 단계 예측이므로 실행 중 프로브·검증 도구를 고친 런은 skip 전에 한 번 되짚을 것.
  - (경미) 정렬 기본값처럼 "옵션 배열 + 초기 선택"이 쌍으로 있는 UI는 초기값을 배열 첫 원소에서 파생시키면 순서 변경 때 드리프트가 원천 차단된다(D2).
- **후속 후보(미해결)**: ① D5 모바일 `GuruDetail` appbar 제목 겹침 아티팩트 수정. ② D4 최대폭 토스트 ↔ `.list-pill`(좌·우) ~30px 겹침 — 필요하면 토스트 `maxWidth` 축소나 pill `bottom` 상향으로 레이어 규약 차원에서 정리(현재는 무해 판정). ③ `GuruManagers`의 `종목수`·`이름순` 칩 초기 방향(각각 오름·내림)이 관례와 어긋나 보이는 점 — 이번 비목표였음.

## Doc updates
- CONTEXT.md promotion: none (신규·변경 도메인 용어 없음 — 정렬 기본값·pill 위치는 구현 세부).
- ADR added: none (3조건 미충족 — 되돌리기 쉬운 표시 변경, 실질 트레이드오프 없음).
- CLAUDE.md: "레이아웃 수치는 추정 금지(task#225)" 가토에 **③ 프로브의 기준 상자도 실측**(+ 좌·우 pill 대칭 성질) 승급.
