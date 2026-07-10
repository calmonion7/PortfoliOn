<!-- forge-slug: admin-delete-other-stock -->
# 2026-06-21 — 리서치 '그외' 탭 관리자 종목 삭제 (전체 사용자 제거, task#97)

## Plan vs actual
- **계획대로 된 것:** 3슬라이스 전부 계획대로. S1 `DELETE /api/admin/stocks/{ticker}`(`require_admin`, `DELETE FROM user_stocks WHERE UPPER(ticker)=%s`로 전 사용자·보유/관심 양쪽 제거, 캐시 무효화, idempotent) + pytest 3개. S2 `handleGlobalDelete` + `StockCard`/`TickerListItem`에서 `is_mine===false`면 수정/승격 숨기고 삭제만 노출·admin 엔드포인트 라우팅·삭제 후 그외목록 재조회. S3 API_SPEC·README·CONTEXT([[그외 종목]]). 백엔드 36 green, 빌드 OK, 사용자 admin 계정 라이브 "잘됨".
- **Divergences (전부 low):** ① Dynamic Workflow 미사용(규모 작아 직접 처리 — 스킬 허용). ② 백엔드 라우터테스트가 mock 기반이라 "두 사용자 교차삭제"를 실 행이 아니라 **SQL에 user_id 필터 부재**로 단언(교차삭제 핵심이 "소유자 필터 없음"이라 등가; 라이브 admin UAT로 보강). ③ `admin.py`가 이미 `execute` import — `cache`만 additive 추가.

## Learnings
- **Do differently / 재사용 가토:** **admin `scope=all` 리포트 목록은 비소유 종목(`is_mine=false`)에도 `category`("holdings"/"watchlist")를 무조건 붙인다**(`report.py:_mk_entry`, 글로벌 포트폴리오 멤버십 기준). 그래서 카테고리로 게이트된 관리/액션 버튼(수정·승격·삭제)이 **남의 종목에도 노출**되는데, 그 핸들러가 호출하는 건 호출자 본인 user_stocks만 검사하는 user-scoped 엔드포인트(`/api/watchlist|portfolio/{ticker}`)라 **404로 조용히 깨졌다**(증상="관심 목록에 없다"). → **액션 버튼 가시성은 category가 아니라 `is_mine`으로 게이트**, 관리자의 교차-사용자 동작은 `/api/admin/*` 전용(`require_admin`, ticker 단위 전 사용자 삭제)으로 분리. CLAUDE.md 가토 승급(아래).
- **패턴(재사용):** 양 렌더러(`StockCard` 그리드 + `TickerListItem` 사이드바)가 동일 버튼 블록을 갖는다 — 한쪽만 고치면 다른 화면에서 깨진 채 남는다. 버튼/액션 변경은 항상 **두 곳 동시** 수정(grilling 단계 grep으로 사전 포착).
- **관찰:** 직접 처리(워크플로우 생략)가 1엔드포인트+버튼 규모엔 더 빠르고 저렴. 스킬의 "단일 에이전트 규모면 워크플로우 생략" 가이드가 정확히 들어맞은 사례.

## Doc updates
- **CONTEXT.md promotion:** [[그외 종목]] (그릴링 단계에서 이미 추가 — 정본 정의: scope=all+is_mine=false, admin 삭제=전 사용자 제거·스냅샷 고아).
- **ADR added:** none — 단일 엔드포인트·되돌리기 쉬움(3-gate 중 hard-to-reverse 미충족). 파괴적 의미(타 사용자 데이터 함께 삭제)는 confirm 다이얼로그 + CONTEXT 용어에 명시로 충분.
- **CLAUDE.md:** 가토 1건 추가 — "scope=all action-button leak / is_mine 게이트 / admin 교차-사용자는 /api/admin" (task#97).
