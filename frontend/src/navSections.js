// 마스트헤드 IA 5섹션(ADR-0026, 원형 ADR-0025)의 **단일 소스**.
// 예전엔 Masthead(SECTIONS)·MobileNav(RESEARCH_PATHS/SCHEDULE_PATHS)·ResearchShell(RESEARCH_TABS/
// SCHEDULE_TABS) 세 곳이 같은 IA를 수기 복제했고, 그중 한 곳만 빠뜨리는 게 실질 재발 경로였다
// (task#215=탭 추가 시 PC 누락, task#251=심층 리포트 상세에서 세 표면 모두 현재 위치 상실).
// 여기엔 **순수 경로·라벨 데이터만** 둔다 — 아이콘 셋은 소비처마다 다르므로(Masthead=sketches,
// MobileNav=ui/icons) 각자 key로 매핑한다.
//
// eco: match는 to와 다를 때만 단다. 접두사 매칭은 앱 전역 관례다(상세에서 부모 탭 강조 — `/guru/:id`와 동일).
// match는 문자열 하나 또는 **배열**을 받는다 — task#324에서 「심층 리포트」 항목이 nav에서 빠지고
// 그 경로들이 「리포트」 항목에 흡수됐다(ADR-0047: 종목 축 1:N이라 화면에서 합친다). 한 항목이
// 접두사 관계가 없는 여러 경로를 덮어야 하므로 단일 문자열로는 표현되지 않는다.
// 천장: 형제 항목끼리 접두사 관계가 생기면 그때 세그먼트 경계 매칭으로 올려야 한다.
export const NAV_SECTIONS = [
  {
    key: 'research', label: '리서치', perm: 'research',
    items: [
      // `/analyst-report`(단수)가 문서 상세와 목록 `/analyst-reports`(=admin 발행 관리)를 함께 덮는다
      { to: '/reports', label: '리포트', evt: 'tab_reports', match: ['/reports', '/analyst-report'] },
      { to: '/recommend', label: '추천' },
      { to: '/ranking', label: '랭킹', evt: 'tab_ranking' },
      { to: '/compare', label: '비교', evt: 'tab_compare' },
      { to: '/tech-reports', label: '주요기술', match: '/tech-report' },
    ],
  },
  {
    key: 'portfolio', label: '포트폴리오', perm: 'portfolio',
    items: [{ to: '/portfolio', label: '포트폴리오', evt: 'nav_portfolio' }],
  },
  {
    key: 'market', label: '시장', perm: 'market',
    items: [
      { to: '/market/indicators', label: '시장지표', evt: 'nav_market' },
      { to: '/market/flow', label: '수급지표', evt: 'nav_market' },
    ],
  },
  {
    key: 'schedule', label: '일정·인컴', perm: 'research',
    items: [
      { to: '/calendar', label: '캘린더', evt: 'tab_calendar' },
      { to: '/dividends', label: '배당' },
      { to: '/digest', label: '다이제스트', evt: 'tab_digest' },
    ],
  },
  {
    key: 'guru', label: '구루', perm: 'guru',
    items: [{ to: '/guru', label: '구루', evt: 'nav_guru' }],
  },
]

export const matchesItem = (pathname, item) => {
  const pats = item.match ?? item.to
  return (Array.isArray(pats) ? pats : [pats]).some(pat => pathname.startsWith(pat))
}

export const matchesSection = (pathname, section) => section.items.some(i => matchesItem(pathname, i))

export const sectionByKey = key => NAV_SECTIONS.find(s => s.key === key)
