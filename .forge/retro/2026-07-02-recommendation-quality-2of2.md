<!-- forge-slug: recommendation-quality-2of2 -->
# 2026-07-02 — 추천 화면 개선: market 필터 + 딥다이브 분석 상태 (task#131, part 2/2)

## Plan vs actual

- 계획대로: S1~S5 전 슬라이스 충족. Dynamic Workflow 5 에이전트(백엔드 TDD → 프론트 ‖ 문서 → 통합검증 → 적대 리뷰, sonnet+ECO, ~357k 토큰, ~13분). market 필터는 read 레벨 시장별 상위(기존 markets 파라미터 재사용, store 무수정), enriched는 빈 목록 시 read 생략+call_count 못박기(additive-read 가토 준수), 칩은 기존 filter-chips 관례 재사용, 배지 전용색(가격 토큰 금지 준수). 백엔드 1010·프론트 vitest 41 green(신규 10, red 확인)+build. 커밋 dd815220 push.
- Divergences:
  1. **'분석 보기' 딥링크 미완 — 메인 세션이 커밋 전 보정**: 워크플로우는 `<Link to="/" state={{tab,ticker}}>`만 만들었고 Research.jsx가 location.state를 읽지 않아 **리포트 상세 진입이 실제로 안 됐다**. 적대 리뷰가 이를 포착했으나 "동작 결함 아님"으로 minor/must_fix=false 분류 — 계획 DoD("리포트 상세 진입") 기준으론 실질 must-fix. 보정: Research가 location.state 소비(같은 라우트 재네비게이션은 재마운트 없음 → useEffect 반응) + 수동 탭 전환 시 deepTicker 해제(자동 진입 반복 방지) + Reports `initialTicker` prop(목록 로드 후 최신 날짜 상세 자동 진입). 보정 후 41 green·빌드 재확인.
  2. CLAUDE_COWORK_API.md "해당 없음" 판단(정당): `/api/recommendations`는 Cowork 소비 대상이 아니라 원래 미등록 — 문서 역할 분담 존중으로 미추가. 단 계획 DoD 문구("두 문서 모두")가 이 재량을 안 담아 리뷰와 충돌.
  3. 기존 endpoint 테스트 2건 갱신: call_args 마이그레이션은 해당 없음, 대신 신규 `_latest_snapshots` 호출의 실 DB 진입 방지 patch + exact-비교 dict에 `"enriched": False` 추가(additive 필드의 exact-단언 파급, 예상 범위).
- 라이브 UAT: TDD 게이트 verified: yes. 라이브 클릭 UAT(칩·배지·딥링크)는 배포 settle 후 관측 후보.

## Learnings

- Do differently next time:
  1. **적대 리뷰 findings의 must_fix 분류를 "동작 결함" 기준이 아니라 계획 DoD 기준으로 재평가할 것** — 리뷰어는 "기능이 안 깨졌다"로 minor 처리했지만 DoD가 약속한 UX("상세 진입")가 미이행이면 실질 must-fix다. 리뷰 프롬프트의 must_fix 정의에 "계획 DoD 위반"을 명시했는데도 리뷰어가 보수적으로 분류 → 핸드오프 전 메인 세션이 minor 목록을 DoD와 대조하는 단계를 상시화.
  2. **같은 라우트 재네비게이션은 재마운트되지 않는다 — Link state 딥링크는 수신 컴포넌트가 location.state를 명시 소비해야 동작.** "이동하니 열리더라"는 우연(기본 탭 일치)일 수 있으니 상태 배선을 코드로 확인. 반복 진입 방지(소비 후 해제)까지가 한 세트.
  3. **계획 DoD에 조건부 재량("문서에 해당 엔드포인트가 있으면")을 문구로 남길 것** — 프롬프트에만 두면 DoD 텍스트와 구현 판단이 충돌해 리뷰 노이즈가 된다.
- 관찰(후속 후보, 차단 아님): 라이브 클릭 UAT(칩 전환·enriched 배지·딥링크 자동 진입) — 배포 settle+재계산 후. Recommendations의 market refetch와 초기 fetch의 경합은 없음(칩 전환 시 discovery만 갱신) — 라이브서 재확인만.

## Doc updates

- CONTEXT.md promotion: none — 신규 도메인 용어 없음([[딥다이브]] 정의 불변, 분석 상태 배지는 구현 표면).
- ADR added: none — additive 파라미터·UI 배선이라 가역적, ADR 3조건 미충족.
- CLAUDE.md: none (1of2 회고에서 마이그레이션 쌍 가토 승급 — 본 파트 고유 승급 없음).
