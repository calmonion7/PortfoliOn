# 2026-06-20 — 모바일 오버플로우·잘림·터치타깃 일괄 수정 (task#80)

> task#78 UI/UX 진단이 자동 분해한 fix 클러스터 6건(#79~84) 중 하나. 커밋 9f9e4b55.

## Plan vs actual
- What went as planned:
  - S1~S4 완료. `.seg > button` nowrap+축소로 '다이제스트' 한 줄, Portfolio 모바일 컨테이너 하단 패딩으로 마지막 카드 탭바 안 가림. Analytics 히트맵 overflow 래퍼·ConsensusChart 툴팁 maxWidth·Sections 공시 5열 테이블 래퍼·Ranking 종목명 2줄 클램프. 터치타깃 ≥44px. 캘린더 셀 minHeight 56+날짜/이벤트 상하분리. 라이브: 홈/포폴/시장/구루 4라우트 scrollW=clientW=390(오버플로우 0).
- Divergences:
  - **근본원인 2건이 죽은/잘못된 CSS 표면이었음**:
    1. **하단 잘림**: G1 에이전트가 하단 패딩을 `.holdings-list`에 줬으나 그 클래스는 **미렌더(dead)**. 실제 모바일 대시보드는 `<div style={{padding:'0 20px'}}>` → Portfolio.jsx 인라인을 직접 `'0 20px 100px'`로 고침(진짜 수정).
    2. **GuruStats 가로 오버플로우(scrollW 432>390)**: 단일컬럼 그리드 `'1fr'`(=minmax(auto,1fr))이라 트랙 최소가 카드 min-content로 팽창 → `minmax(0, 1fr)`로 교체(트랙 최소 0 → minWidth:0/ellipsis 발효).
  - **dead-class cruft 정리**: G1이 추가한 `.row-edit/.row-del` 터치타깃 규칙은 미렌더 클래스라 제거(실효 터치타깃은 Reports.jsx 인라인). `.m-cal-wk`도 mobile.css 정의됐으나 캘린더는 Calendar.jsx 인라인 렌더 — 무해라 보존.
  - RecCard 종목명 클램프는 담당파일 밖이라 보수적 스킵(후속 후보).

## Learnings
- Do differently next time:
  - **CSS 클래스를 고치기 전 그 클래스가 실제 DOM에 렌더되는지 확인** — mobile.css/pc.css에 권위 있어 보이는 미렌더 클래스(`.holdings-list`·`.m-cal-wk`)가 다수라, 에이전트가 dead 클래스를 고치면 무효다. 실효 소스는 인라인 스타일/다른 클래스인 경우가 많다(CONCERNS #17로 승급).
  - **모바일 단일컬럼 그리드는 `minmax(0, 1fr)`** — `'1fr'`(=minmax(auto,1fr))은 트랙 최소가 콘텐츠로 팽창해 ellipsis가 안 먹고 가로 넘침을 만든다.
  - 터치영역(44px)·모션은 정적 스크린샷으로 확인 불가 → scrollWidth/치수 측정+코드로 검증.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none
- 기타: `.forge/codebase/CONCERNS.md` #17 신규 "죽은/레거시 CSS가 수정을 오도" 추가(이 작업 #80 + #83의 교차 교훈). dead 클래스(`.m-cal-wk`/`.holdings-list`) 청소는 후속 후보.
