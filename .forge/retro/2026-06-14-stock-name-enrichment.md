# 2026-06-14 — 종목명 신뢰성 (추가 자동채움 + 백필 + 스냅샷 전파)

## Plan vs actual
- What went as planned: S1 `market.resolve_name`(입력 비거나 티커면 quote 실명) + add/watchlist 배선, S2 admin 백필 엔드포인트, S3 update_ticker_meta 스냅샷 전파. resolve_name 분기 6/6·백엔드 494 pytest PASS. main 537d797f 배포.
- Divergences:
  - **(UAT서 발견·보강 a4be02a5) 2차 결함 2개** — 첫 배포 후 사용자 화면에서 005930(삼성전자)이 리서치 목록에 그대로(변경안됨):
    1. **백필 조건이 좁아 부분교정 행을 놓침**: 사용자가 `tickers.name`을 이미 삼성전자로 수동교정 → `name==ticker` 후보에서 빠짐 → 그 **스냅샷**(005930)은 미갱신. `reconcile_snapshot_names`(모든 스냅샷 name을 현재 tickers.name과 강제 동기화)를 백필에 추가해 해소. 재백필 결과 `reconciled 3['000660','005930','034020']`.
    2. **캐시 무효화 누락**: `refresh_snapshot_names`가 DB만 바꾸고 리포트 목록 캐시(`get_list` 60s TTL)·스냅샷 LRU를 안 비워 화면 미반영 → `invalidate(ticker)`+`invalidate_list()` 추가(storage 지연 import로 순환참조 회피).
  - **(관측·범위 밖)** `ticker`가 `"AAPL MSFT NVDA GOOGL …"`(공백결합 다중티커)인 오염 row 1개(yfinance 404). 백필 무시·정상완료. 출처 추적/정리는 후속.
  - **(설계)** promote·get_watchlist 폴백은 tickers row 상속이라 S1로 자동 개선(미변경). CLAUDE_COWORK_API 미반영(admin/읽기 액션이라 Cowork 표면 아님 → API_SPEC만).

## Learnings
- Do differently next time:
  - **"누락분 백필"을 한 조건으로 좁히지 말고 "마스터에 맞춰 reconcile"을 고려** — `name==ticker`만 고치면 이미 부분교정된 행(tickers는 맞고 파생본만 옛값)을 놓친다. 마스터(tickers.name)와 파생본(snapshot.name)을 강제 동기화하는 reconcile 패스가 더 견고. 같은 데이터가 여러 곳(원본+박제)에 살면 "원본만 고치면 끝"이 아니다.
  - **캐시 뒤 데이터를 바꾸면 캐시 무효화를 같은 커밋에 묶어라** — DB만 고치고 리포트 목록(`get_list` 60s)·스냅샷 LRU를 안 비워 "변경안됨"으로 보였다. price-flash의 "머지가 죽은 필드에 씀"과 같은 *데이터는 바뀌었는데 UI 미반영* 부류 — 변경 경로마다 "이 값을 읽는 캐시는 무엇이고 언제 비나"를 확인. (storage↔cache 순환참조는 함수 내 지연 import로 회피.)
  - **dual-source 표시값은 양쪽을 함께 손봐야** — 종목명은 `tickers.name`(live, 종목관리)과 `snapshot.data.name`(박제, 리서치) 두 곳. live만 고치면 목록↔상세가 어긋난다(이번 005930). 이름 쓰는 모든 경로(add/edit/backfill)가 둘 다 갱신.
  - **prod 쓰기 가드레일이 더 강해짐**(재확인): 이번엔 docker exec **import 체크**(DB 미접근)까지 차단됐다. 프로덕션 검증은 처음부터 사용자 `!`/admin 경로로([[reference-prod-writes-need-user]]).

## Doc updates
- CONTEXT.md promotion: none (데이터 흐름·구현 — 도메인 어휘 아님)
- ADR added: none (reconcile-vs-live는 트레이드오프지만 되돌리기 쉬움 — ADR 3요건 미충족)
- CLAUDE.md: 종목명 dual-source(tickers.name/snapshot.name) + 이름변경 시 reconcile·캐시무효화 gotcha 추가(사용자 확인 후)
- 메모리: [[reference-prod-writes-need-user]]에 "import 체크까지 차단" 보강
- 후속 후보: 깨진 ticker row(`"AAPL MSFT NVDA …"`) 출처 추적·정리
