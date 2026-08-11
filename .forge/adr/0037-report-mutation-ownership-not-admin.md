# 0037 — 리포트 변경 엔드포인트 2건은 형제 배치 관례(`require_admin`)가 아니라 「소유권 OR admin」으로 게이트한다

- 상태: 채택 (Accepted)
- 날짜: 2026-08-11
- 관련: task#291(B50), `.forge/codebase/CONCERNS.md` §5.7·§0(B50 닫힘), ADR-0029(공개 read 없음 — 같은 장르의 인증 경계 규칙), ADR-0008(컨센서스 정본 = `daily_consensus_mart`)

## 맥락 (Context)

`routers/report.py::refresh_analyst`·`::backfill_consensus`는 `user_id`를 `Depends(get_current_user)`로 받고도 **본문에서 쓰지 않아**, 인증만 하면 자기 포트폴리오 **밖** 임의 종목의 전역 공유 `snapshots`·`daily_consensus_mart`·`raw_reports`를 변경시킬 수 있었다(B50).

**같은 파일의 형제 배치 엔드포인트 8개는 전부 `require_admin`이다**(`backfill_all`·`generate_all`·`refresh_all_backlog`·`refresh_all_disclosures`·`refresh_all_us_supply`·`refresh_all_insider_trades`·`refresh_all_agm`·`batch_consensus`·`refresh_backlog`). 그래서 "전역 공유 상태를 바꾸면 admin"이 이 라우터의 표면적 관례로 보이고, task#291 계획도 `backfill_consensus`에 대해 그렇게 판단했다.

**그 판단은 틀렸고, 배포 직전에 적대적 리뷰가 잡았다.** 두 엔드포인트에는 형제 배치들과 달리 **사용자 대면 프론트 소비처가 있다**:

- `refresh_analyst` ← `components/reports/DetailTab.jsx`의 「데이터 갱신」 버튼
- `backfill_consensus` ← `components/reports/ConsensusChart.jsx`의 「백필」 버튼

그리고 **두 버튼 모두 role 게이팅이 없다**(`isAdmin|role ===|role !==|user?.role` grep 0건). `require_admin`으로 좁히면 전 비admin 사용자가 **자기 보유 종목에서도** 403을 받는다 — 경계 강화가 아니라 **기능 회귀**다. 계획은 이 결과를 `refresh_analyst`에 대해서는 명시적으로 거부했는데(「`require_admin`을 걸면 동작 중인 사용자 기능을 제거한다」), `backfill_consensus`에는 「프론트 소비처 없음(grep 0)」이라는 **거짓 전제** 때문에 반대 결론을 적용했다.

## 결정 (Decision)

두 엔드포인트는 **`Depends(get_current_user)`를 유지**하고, 본문 선두(스냅샷 `query` **앞**)에서 공통 헬퍼 `routers/report.py::_require_owner_or_admin`를 호출한다:

- `find_ticker(storage.get_all_stocks(user_id), upper)`가 있으면 통과(보유·관심 무관).
- 없으면 `_auth_svc.get_user_by_id(user_id)`의 `role != "admin"`일 때 **403**. `caller`가 None이면 fail-closed로 403.

부가 규칙 3가지:

1. **admin이 소유권을 우회하는 것은 필수다.** admin은 리포트 목록 `scope=all`("그외" 탭)로 남의 종목 상세를 여는 지원된 경로가 있고, 그 화면의 버튼은 소유권을 보지 않는다. 순수 소유권 검사를 넣으면 admin이 자기 화면에서 거부된다(task#97·#103이 겪은 "버튼은 보이는데 핸들러가 거부"의 재현). 판정은 `list_reports`의 기존 role 패턴을 그대로 쓴다.
2. **거부 코드는 403이고 검사는 스냅샷 조회보다 먼저다.** 403(소유권 차단)과 404/400(소유권 통과 + 스냅샷 부재)이 **코드로 갈려** 라이브 검증이 문자열 의존을 벗어나고, 거부가 DB에 닿지 않아 무쓰기가 구조적으로 성립한다.
3. **가드는 헬퍼 하나다.** 두 곳에 복제하면 드리프트하고, 단일 헬퍼면 결함 주입 검증이 두 엔드포인트에 대칭으로 걸린다.

## 검토·기각한 대안 (Considered Options)

- **(기각) `backfill_consensus`만 `require_admin`** — 형제 배치들과 정합하지만 「백필」 버튼을 전 비admin에게서 깨뜨린다. 실제로 이 안으로 구현했다가 배포 전에 되돌렸다.
- **(기각) `require_admin` 유지 + 프론트에서 버튼 숨김** — 정책적으로 일관되지만 `frontend/` 변경이 필요하고, 그러려면 `GET /report/{ticker}/{date}` 응답(현재 소유권 필드 없음)에 `is_mine`을 additive로 추가하고 admin 판정까지 프론트로 내려야 한다. 계약이 늘어난다.
- **(기각) 순수 소유권 검사(admin 예외 없음)** — 위 부가규칙 1의 이유로 admin 화면이 깨진다.

## 결과 (Consequences)

- **B50이 닫혔다** — 비소유자는 전역 공유 스냅샷·컨센서스 마트를 변경시킬 수 없다. 라이브 실측: 배포 전 프로브 9 FAIL/34 → 배포 후 ALL PASS 34/34 ×2런, 공유 3테이블+`user_stocks` 쓰기 0.
- **⚠️ 잔여 위험을 의식적으로 감수했다** — `backfill_consensus`의 `days: int = 180`은 여전히 `Query(..., le=…)` 상한이 없다. 소유권 게이트가 붙어 *남의 종목으로는* 못 부르지만, **자기 보유·관심 종목에는 임의 인증 사용자가 큰 `days`로 외부 제공자를 호출시킬 수 있다** — 도달성은 좁아졌을 뿐 닫히지 않았다. 상한 추가는 task#290·#291 둘 다 비목표로 뒀다(후속 후보).
- **알려진 UI 비일관 1건을 남겼다** — 비admin이 랭킹(`pages/Ranking.jsx::onRowClick` → 모달 → `ReportDetailTabs`)에서 **비소유** 종목 상세를 여는 것은 지원되는 내비게이션인데, 그 화면의 두 버튼은 소유권을 보지 않으므로 누르면 403이 뜬다. 실패는 `refreshError`로 graceful하고 공유 데이터는 보호되므로 게이트 결함이 아니라 버튼 가시성 문제다. 프론트 게이팅은 별도 태스크.
- **다음에 이 라우터의 게이트를 조이려는 사람에게** — 형제 배치가 전부 `require_admin`이라는 사실은 이 두 건에 대한 근거가 되지 못한다. **게이트를 조이는 변경은 그 엔드포인트의 프론트 소비처를 직접 grep해 role 게이팅 유무를 대조할 것.** pytest·vitest·빌드 어느 것도 이 경로를 원리적으로 못 본다(프론트 변경이 0이면 vitest도 무영향).
