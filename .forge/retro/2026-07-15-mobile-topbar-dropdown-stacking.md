# 2026-07-15 — 모바일 상단바 '더보기' 드롭다운 레이어 가려짐 수정 (task#188)

## Plan vs actual
- **계획대로**: 단일 슬라이스, 워크플로우 없이 직접 실행(1줄 CSS). 근본원인 진단대로 `frontend/src/App.css`의 `.mobile-header` z-index를 `10 → 50`으로 상향. commit `800c56f`+push+`npm run build`로 즉시 라이브. 라이브 모바일 UAT(390px) 3종(레이어/모달/검색 오버레이) 통과.
- **Divergences**: 없음(계획=실제). 값·스코프 모두 그릴링 합의대로.

## Learnings
- Do differently next time:
  - **stacking context 천장 함정**: `position:sticky`(또는 아무 positioned) 요소에 `z-index`를 주면 **자체 stacking context**가 생기고, 그게 모든 자손 z-index의 **천장**이 된다. 자손 오버레이가 아무리 큰 z-index(여기선 드롭다운 41, 형제 검색 오버레이는 1000)를 가져도 조상 context의 실효값(10)을 못 넘어, **절대값이 더 낮은 형제 페이지 레이어(appbar 20/fab 25/tabbar 30)에 가려진다**. 증상이 헷갈리는 이유: frosted(backdrop-filter blur+반투명) appbar가 갇힌 팝업 위에 그려져 팝업 상단만 blur로 "흐려" 보이고 탭 텍스트가 위로 겹쳐, "반투명 배경 버그"로 오인하기 쉽다 — 실제 팝업 배경은 불투명(`--bg-elev` #fff)이었다. **드롭다운/오버레이가 "가려짐·흐림"이면 배경 알파가 아니라 조상 sticky 헤더의 z-index 천장부터 의심**하고, 수정은 팝업 z-index를 올리는 게 아니라 **그 조상 헤더의 z-index를 페이지 레이어 위로** 올린다(또는 portal로 context 탈출). 같은 헤더에 있던 검색 오버레이도 같은 함정에 있었는데 전체화면 불투명 시트라 티만 안 났을 뿐 — **한 헤더 컨텍스트에 오버레이 자식이 여럿이면 헤더 레벨 수정이 전부를 한 번에 고친다**.
  - **"레이어 가려짐" 판정은 정적 스샷이 아니라 `elementFromPoint`**: 팝업 각 항목의 rect 중심에서 `document.elementFromPoint(cx,cy)`가 돌려주는 최상위 요소가 실제로 `.more-pop` 내부인지(`el.closest('.more-pop')`) 측정하면 stacking이 결정적으로 검증된다. 스샷만으론 blur/겹침을 "약간 흐린 정상"으로 오판할 수 있다(마커 오버플로우 retro의 "정적 스샷으론 clip 못 잡음 → DOM 측정" 계열 재확인). 회귀도 같은 기법: 모달은 헤더 지점(y=30)에서 최상위가 `.modal-overlay` 안인지로 "모달이 헤더 위 덮음" 확인.
  - 사소한 UAT 함정: 메뉴가 열려 있으면 `.more-backdrop`(전체화면 dismiss 레이어)이 클릭을 가로채므로, 테스트에서 메뉴를 닫을 땐 트리거 버튼 재클릭이 아니라 **backdrop 클릭**으로 닫아야 한다(이건 오히려 backdrop이 최상위에 정상 배치됐다는 증거).

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (되돌리기 쉬운 1줄 CSS, 신규 개념·결정 없음)
- 기타: 일반 CSS/stacking 지식이라 CLAUDE.md/CONCERNS 승급 불요 — retro-log 수준 유지(마커 오버플로우 retro와 동일 판단).
