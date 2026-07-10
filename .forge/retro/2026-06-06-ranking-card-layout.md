# 2026-06-06 — 리서치 랭킹탭 카드형 전환 + 등락률(서버사이드 상승률 상위) 정렬 추가

## Plan vs actual
- What went as planned:
  - 슬라이스 4개 전부 계획대로. **S1**(백엔드, TDD): `ranking_service` value/volume/**change** set + 라우터 `_METRICS` 확장 — 신규 테스트 5건 red→green, 백엔드 전체 345 pass. **S2**: `METRICS`에 `['change','등락률']`. **S3/S4**: 비-수급·수급 테이블 그리드 → 반응형 균일 카드 그리드(`repeat(auto-fill, minmax(260px,1fr))`, ui/Card 재사용), 모달·별표·무한스크롤·표시필드 유지. Non-goals(하락률·메이슨리·수급 등락률 제외) 준수. 커밋 `603a7879` main 배포.
- Divergences:
  - **1차 UAT 실패 → 데이터 populate로 해결 (코드 버그 아님)**: 등락률 토글에 종목이 안 나옴 = `change` set이 배포로 처음 생겨 fetch 전까지 비어 있었음(토요일=장 마감, 자동 fetch 미실행). value/volume 카드는 정상. 사용자 승인(방법 A) 후 `docker exec portfolion-backend-1 python -c "...replace_market_rankings('KR'|'US', get_*_rankings())"`로 KR·US 각 200건(value/volume/change) populate → 공개 API `/api/rankings?metric=change` 상승률 내림차순 확인 → 재UAT 정상(verified: yes). **코드 재커밋/재실행 없음**(603a7879 그대로) — 순수 데이터 populate.
  - **동시 forge 세션 경합**: 병렬 백그라운드 세션들이 단일 `.forge` 활성 슬롯을 공유 → task 6→7→9가 흘러가는 동안 #8은 3회 "대기". #9(etf-report-tabs)가 회고·봉인돼 슬롯이 비자 #8 승격. 실행 중 git HEAD가 `1612631b`(동시 세션의 Ranking.jsx **모달 ETF 탭** 커밋)로 전진 → 편집 전 재읽기로 충돌 영역 없음 확인(내 편집=imports/METRICS/렌더 그리드 vs 동시 변경=ResearchDetail). 백엔드 미커밋 편집 생존, push는 fast-forward.
  - 잘못된 metric은 **400**(플랜의 "422"는 부정확) — 기존 라우터 동작에 맞춤(surgical). `docker compose exec`는 CWD 프로젝트에 backend 미등록이라 실패 → `docker exec <컨테이너명>` 직접 사용.
  - Card(ui) 재사용으로 미사용이 된 `GRID_COLS`/`SUPPLY_GRID_COLS` 상수 고아 정리.

## Learnings
- Do differently next time:
  - **신규 랭킹 metric = 배포 후 데이터가 따로 채워져야 보임**: `market_rankings`에 해당 metric 행이 fetch로 쌓이기 전엔 빈 결과 → "버그처럼" 보임. 비거래일 배포 시 자동 fetch가 안 돌아 특히 그렇다. → 배포 직후 admin `POST /api/rankings/refresh?market=KR|US` 또는 컨테이너 직접 populate로 즉시 채우고 UAT할 것. (advisory-insights의 "additive 배포순서 gotcha"와 같은 결: 코드는 배포됐지만 **데이터/스키마가 따라오지 않으면** 사용자에겐 미작동으로 보임.)
  - **병렬 forge 세션 ↔ 단일 활성 슬롯**: 여러 백그라운드 세션이 한 `.forge`를 공유하면 활성 슬롯이 경합한다. 다른 세션이 같은 소스를 커밋해 HEAD가 움직일 수 있으니, **편집 직전 대상 파일을 재읽기**(File-modified 가드)하고 커밋·push는 묶어서 빠르게. 충돌 영역이 분리돼 있으면 fast-forward로 무사.
  - **배포 폴러**: 5개 파일 한 커밋·즉시 push로 hard-reset 소실 회피(기존 교훈 재확인).

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음 — 등락률·change metric은 기존 용어·구현; `사용처`에 "랭킹 탭" 이미 존재)
- ADR added: none (등락률 서버사이드 metric·카드 레이아웃 모두 additive·되돌리기 쉬움 — ADR 3조건 미달)
- auto-memory: 완료 포인터 + "신규 metric 배포 후 fetch 필요" gotcha 기록(사용자 요청)
