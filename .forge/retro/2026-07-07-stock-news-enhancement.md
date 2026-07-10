# 2026-07-07 — 종목 뉴스 강화 (task#152)

워크플로우 4-phase(백엔드 S1 → 적대적 검토 → 수정(생략) → 프론트 S2). eco: sonnet 캡+ECO. 배포·라이브 UAT 통과(verified: yes).

## Plan vs actual
- What went as planned:
  - S1 `scraper.get_news` 5→10 + 공유 `_dedup_sort_limit`(링크 dedup·최신순), `digest_service._recent_news`(=`routers.stocks._latest_snapshots` 재사용, **스냅샷 news만 읽어** 종목당 top2·스크레이프 0), API_SPEC(API_SPEC만). test_scraper 6 + digest 3(scraper 호출 0 단언). pytest 1165.
  - S2 `ReportDetailTabs` liveNews state — `/api/stocks/{ticker}/news` 라이브 fetch, `news=liveNews?.length?liveNews:summary.news`로 실패/빈값/로딩 시 스냅샷 폴백(Ranking 패턴). `Digest.jsx` 종목 뉴스 섹션. npm build green.
  - 라이브 UAT: news 엔드포인트 10건·dedup0·최신순, 심층분석 탭 라이브 뉴스 10건(fresh 07-06/07·최신순 렌더), digest 재생성 news 48건=24종목×top2·화면 섹션 렌더. 3축 전부 확인.
- Divergences (전부 저위험):
  1. **적대적 검토 minor 1건 = 코드결함 아닌 커밋 위생**: 신규 `test_scraper.py`가 untracked라 tracked 4개만 add하면 S1 회귀테스트가 저장소에서 유실될 위험 → 명시적 `git add`로 **8파일 스테이징 확인** 후 커밋(수용). critical/major 0.
  2. **digest 스냅샷 read 재사용**: 새 쿼리 대신 `routers.stocks._latest_snapshots`(배치 DB-read) 지연import — 스크레이프 0. 계획 의도 정확 달성.
  3. **eco**: `decodeHtml` 3번째 로컬 중복(각 4줄, 4번째 소비처 시 추출).

## Learnings
- Do differently next time:
  - **배치가 채우는 응답 필드는 `latest`(배포 전 생성분)엔 없어 UAT 시 안 보인다 — 재생성 선행**: digest news 필드가 배포 후에도 `/api/digest/latest`엔 없어 처음 undefined였다(배포 전 생성된 다이제스트). `POST /api/digest/generate`로 재생성해야 새 필드가 채워져 UAT 가능. task#150 admin 백필과 같은 계열 — **저장값/배치-백킹 기능은 UAT 전에 refresh/regenerate가 필요**하다는 걸 UAT 계획에 반영.
  - **적대적 검토 렌즈에 "커밋에서 살아남나"가 유효**: 이번 minor는 코드가 아니라 신규 파일 untracked라는 *커밋 위생* 리스크였고, 4파일만 add했으면 회귀테스트가 조용히 사라졌을 것. 신규 파일이 있는 슬라이스는 커밋 시 `git status`로 파일 수를 명시 확인.
  - **UAT 탭 네비: 아이콘 prefix 라벨은 exact-match 불발**: 리포트 상세 탭이 "📝 심층분석"이라 `textContent===('심층분석')`가 실패 → 요약 탭에 머물러 "뉴스 없음" 오판. Playwright 탭 클릭은 contains 매치를 쓸 것(라이브 fetch는 이미 200이었으므로 렌더 버그로 오인할 뻔).

## Doc updates
- CONTEXT.md promotion: none — 「뉴스」는 fg-ask 그릴링 때 등재(라이브 fetch·스냅샷 폴백·공시 피드/recent_disclosures 구분). 실행 중 새 용어 없음.
- ADR added: none — 라이브 fetch/스냅샷 read 선택 모두 국소·가역.
- 후속: 없음(코드). (사용자·admin) beta_fetch 백필로 포트폴리오 베타 실값 확인은 여전히 대기(task#150 이월).
