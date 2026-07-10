# 2026-07-10 — 헌트164 상위 클러스터 수정 (task#165)

## Plan vs actual
- 계획대로 된 것: 4슬라이스 병렬 수정(캐시 유출·date.today 스윕 18파일+AST 가드·fx 머지·store 트랜잭션/us_supply 가드) + 적대 리뷰 2렌즈 → 전체 pytest 1241 green → push `ecbe39c` 배포·라이브 스모크 통과. 심볼 변경 시 patch 테스트 전수 grep 가토를 계획에 명시한 대로 침(get_list 3파일·kiwoom_sector date freeze·rec_store execute mock 마이그레이션 — 파손 0).
- Divergences (낮음):
  - 적대 리뷰 CONFIRMED MEDIUM 1건(fx history 클로버)을 **메인 세션 재검증에서 거짓양성으로 기각** — 리뷰어가 `_fetch_fx`의 stored_history 폴백(fx.py:36-40)을 놓침.
  - 스윕이 남긴 고아 `_dt` import 2건(kiwoom chart·investor)을 리뷰가 잡아 메인이 제거.
  - us_supply 가드의 sparse 티커(신규 IPO·ETF 등 genuinely-empty) 영구 미저장은 wrong<missing으로 수용(이전 동작은 글리치 시 실데이터 클로버).
  - 배포 직후 스모크 502: 기동 캐치업(미생성 US 리포트 28종 재생성)이 uvicorn 바인딩 전에 돌아 수 분간 무응답 — 로그로 정상 기동 확인 후 폴링 대기로 해소. 부수: 이 28종 "미생성" 판정 자체가 date 수정의 라이브 증거(옛 코드가 오늘 07:00 배치를 UTC 전일 날짜로 박제 → KST 기준 미생성 감지 → 올바른 날짜로 재생성).

## Learnings
- Do differently next time:
  - **적대 리뷰의 CONFIRMED 판정도 메인 세션이 코드로 재검증 후 수정할 것** — 검증 에이전트의 CONFIRMED가 폴백/가드 경로를 놓친 거짓양성일 수 있다(fx history 건). "CONFIRMED니까 바로 fix" 자동화(FixReview 단계)에 크리티컬만 넣고 MEDIUM 이하는 메인 재검증을 거치는 이번 구조가 유효했다 — 유지.
  - **배포 직후 라이브 스모크는 백엔드 기동 캐치업 완료를 기다려야** — 이 앱은 기동 시 미생성 리포트를 동기 재생성해 uvicorn 바인딩이 수 분 늦을 수 있다(502 ≠ 배포 실패). `docker logs`로 기동 단계 확인 → 폴링 대기가 올바른 순서.
  - 대량 기계 스윕(import 추가/치환)은 **고아 import 잔존이 상수 부작용** — 스윕 에이전트 프롬프트에 "교체 후 파일별 unused import 확인"을 명시하면 리뷰 라운드 하나를 아낀다.
  - 잔여 후속 후보: 헌트164 나머지 7건(성능 3·프론트 2·universe 시장 분리·rebalance 캐싱).

## Doc updates
- CONTEXT.md promotion: 없음
- ADR added: 없음
