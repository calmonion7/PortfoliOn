# 2026-07-18 — 앱 전체 차트 범례 감사 — 범례 신설 + 용어집 배선 (task#199)

## Plan vs actual

- What went as planned: 감사(Explore 서브에이전트, 22개 차트 표) → 용어집 보충(CPI·MoM·상관계수+alias 4) → 범례 신설 2곳(Analytics 기회버블 색 의미·코스피 신호 셀 색) → recharts 범례 7곳 GlossaryRechartsLegend 교체 → 라이브 프로브 EXIT=0. "단일 계열+자명 제목엔 범례 강제 금지" 비목표가 노이즈를 막았다.
- Divergences (경미 2건): ① 신설 대상이 예상보다 적었음(기존 차트 대부분 Legend 보유) — 작업 무게중심이 신설→배선으로 이동. ② inline-flex 범례 컨테이너에 GlossaryText를 직접 넣으면 매칭으로 쪼개진 텍스트 노드들이 각각 flex 아이템이 돼 문장 중간 gap·innerText 개행이 생김 — 단일 span 래핑으로 수정(991e7a7).

## Learnings

- Do differently next time:
  - **텍스트를 노드로 쪼개는 컴포넌트(GlossaryText류)는 flex/grid 컨테이너의 직접 자식으로 두지 말 것** — 텍스트 노드가 익명 flex 아이템이 되어 gap이 문장 중간에 끼고 innerText에 개행이 낀다. 항상 `<span>`으로 한 번 감싸 단일 아이템으로.
  - **접힘형 섹션(SectionCard)은 접힘 상태에서 children을 렌더하지 않는다 — "라벨/범례 부재" 판정 전에 전부 펼치고 단언할 것.** 시장지표 탭 프로브가 0건으로 나온 원인이 전부 접힘이었다(∨ 토글 일괄 클릭 후 8용어·5범례 확인). task#196 회고의 "부재 판정 grep은 전체 출력" 규칙의 DOM판.
  - **텍스트 존재 단언은 innerText가 아니라 textContent+가시성(rect)으로** — innerText는 flex 분절·비가시 요소에 따라 개행/누락이 생겨 존재하는 요소도 거짓 부재로 판정한다.
  - 일반어(예: '스프레드')는 용어집 alias로 넣지 말 것 — 문맥이 다른 곳(신용 스프레드)에 오매칭된다(wrong<missing). 용어 키는 문맥 고유성이 있는 표기만.

## Doc updates

- CONTEXT.md promotion: none.
- ADR added: none (전부 프로세스/플랫폼 학습 — 비가역 결정 없음).
