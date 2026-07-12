# Retro — 리서치 고정핀 + 검색바 노출 (task#182)

- 날짜: 2026-07-12
- slug: research-pin-and-search-bar
- 검증: yes (라이브 UAT — API 핀 왕복 pin=true→지속→원복+미소유 404 / 모바일 캡처: 리서치 검색바 노출·핀버튼 📌 렌더·일정탭 미노출)

## 요약

전역 종목검색이 "있는데 아무도 못 찾는" 문제를 검색바 노출로, 긴 관심목록 상단 고정을 고정핀으로 해결. 3병렬 워크플로우(백엔드 핀/프론트 핀/검색바)→적대적 리뷰→빌드·테스트 검증. eco 서브에이전트(sonnet).

## Divergences (계획 ↔ 실제)

1. **[critical, 적대적 리뷰가 포착→in-run 수정] 핀된 관심종목 승격 시 pinned 유실.**
   계획 Source-of-truth는 "user_stocks UPSERT들이 명시적 컬럼 SET/DO NOTHING이라 신규 pinned를 안 덮는다"고 단정했다(Explore 확인). 이 단정은 add/edit/delete UPSERT 경로엔 맞지만 **승격(promote) 경로는 예외**였다: `promote_to_holdings`가 `save_watchlist_tickers`(하드 `DELETE`)로 watchlist 행을 통째 지운 뒤 `save_holdings`가 신규 `INSERT`를 태워, pinned가 스키마 기본값(false)으로 리셋됐다(반대방향 강등은 `save_holdings`의 UPDATE 분기라 보존돼, 비대칭이 승격이 깨진 경로임을 확증). **수정**: 승격 경로에서 `save_watchlist_tickers` 호출 제거 — `save_holdings`의 `INSERT … ON CONFLICT(user_id,ticker) DO UPDATE`가 기존 watchlist 행을 `type='holding'`으로 전환하고 pinned는 SET절에 없어 자동 보존(PK가 user_id+ticker, type 무관). 삭제가 추가보다 안전(기존 UPSERT 재사용). 회귀 테스트 `test_promote_moves_ticker_to_holdings`를 save_watchlist_tickers 미호출 단언으로 갱신.

2. **[medium, 미수정·follow-up] `get_global_portfolio`(admin scope=all / Cowork API-key 경로) `us.pinned` 미선택** → 그 경로 pinned 항상 false. UI에선 마스킹(scope=all은 `!is_mine`만 렌더 + StockActions가 is_mine=false면 핀 버튼 미표시). 본인 종목 핀 기능엔 영향 없음.

3. **[low, 미수정·follow-up] `handlePinToggle` 전용 훅 유닛테스트 부재** — 정렬(useReportFilters.test 17개)·엔드포인트(test_portfolio_router)·API 라이브는 커버되나 훅 success/error 분기 미검증.

4. **[계획 밖·정당] `set_pinned`를 `services/storage/__init__.py` re-export 추가**(ADR-0017 모듈-속성 접근 패턴상 `storage.set_pinned` 해석에 필수).

5. **[경미] 검색바 spacing은 신규 CSS 0, 기존 `.seg-pad` 재사용**(seg 필과 동일 리듬).

## Learnings

- **Do differently next time — 신규 컬럼을 user_stocks에 붙일 땐 "UPSERT가 보존한다"를 add/edit/delete뿐 아니라 *승격·강등* 경로까지 확인하라.** 승격은 `save_watchlist_tickers`(DELETE)+`save_holdings`(INSERT)로 행을 재작성해, 미언급 신규 컬럼이 조용히 기본값으로 리셋된다. 이는 CLAUDE.md의 **"배치-백킹 store의 delete-rewrite는 fetch 실패 시 유실"(task#160 dividends replace_schedule)** 가토와 동형 — *delete+insert 재작성 경로는 명시하지 않은 상태를 잃는다*는 같은 가족. 컬럼 추가 슬라이스의 계획 단계에서 type 전환(승격/강등) 경로를 UPSERT 보존 가정의 반례로 먼저 점검할 것.
- **적대적 리뷰 phase가 impl 3에이전트 + 빌드 + 1275 백엔드 테스트가 모두 놓친 이 데이터손실을 잡았다.** 데이터 뮤테이션·마이그레이션·인증을 건드리는 슬라이스에 리뷰 phase를 붙인 판단이 적중 — 계속 표준으로.
- **DOM 위치 휴리스틱보다 라이브 캡처를 믿어라.** Playwright `searchBarAboveGrid`(getBoundingClientRect 비교)가 false 오측을 냈지만 스크린샷은 검색바가 목록 위에 정상 배치됨을 보여줬다. retro의 반복 교훈(vitest/DOM은 배치·아이콘충돌·대비를 못 잡고 라이브 캡처만 잡음)의 재확인 — 시각 사실은 캡처로 종결.
- **핀 재정렬 자동클릭이 타임아웃**(FAB(+)·하단 nav가 카드 하단을 가려 scrollIntoView 실패)했지만, 재정렬 로직은 vitest 특성 테스트 + API 핀 왕복·지속으로 이미 검증돼 시각 UAT의 게이트에서 제외 — 하니스 클릭 실패를 제품 결함과 구분.

## 열린 follow-up

- `get_global_portfolio`에 `us.pinned` SELECT+entry 추가(get_full_portfolio와 동일) — admin scope=all/Cowork 경로 정합. (낮은 우선순위, UI 영향 없음.)
- `useStockManagement.test.js`에 handlePinToggle 테스트(handleDelete/handlePromote 패턴 미러).

## Doc updates

- CONTEXT.md promotion: none (고정핀=UI 속성, 도메인 용어 아님 — 계획 결정 유지).
- ADR added: none (승격 pin-유실은 버그픽스로 세 관문(hard-to-reverse·surprising·trade-off) 미충족; 전용 토글 엔드포인트 선택은 계획 시 기록된 구현 결정).
