# 2026-07-28 — 무인증 read 닫기 2/3 (시장지표 17개 인증 게이팅)

> ADR-0029 3부작의 둘째 부. `fg-next all`이 회고를 자동 스킵했고 같은 날 사람이 일괄 승급했다.

## 계획 대비 실제

- **계획대로**: S1(401 단언 17건 red, 각 단언이 `!= 404`를 함께 확인) → S2(GET 17개에 `_: str = Depends(get_current_user)`) → S4(라이브 스모크 17/17 + 프론트 2/2). 백엔드 1359 passed.
- **괴리 ①(최대) — 계획의 대상 경로 4개가 틀렸고, 근원은 CLAUDE.md 오표기였다.** 계획은 "이 라우터는 **prefix가 둘**(`/api/market`·`/api/market-indicators`)"을 전제로 leverage·leverage/coverage·leverage/backfill/progress·lending을 `/api/market-indicators/...`로 열거했다. 실제로는 `APIRouter(prefix="/api/market")` **하나뿐**이고 라이브 대조에서 `/api/market/lending` → **200**, `/api/market-indicators/lending` → **404**. 근원은 `CLAUDE.md`의 lending 엔드포인트 표기이며 fg-ask 그릴링이 그 문장을 사실로 받아 계획에 옮겼다. `API_SPEC.md`는 처음부터 `/api/market/...`로 **옳게** 적혀 있었다 — 두 문서가 어긋나 있었고 계획은 틀린 쪽을 참조했다.
  - **아이러니: 계획이 요구한 `!= 404` 동시 단언이 정확히 이 오류를 잡는 장치였다.** 목록 그대로 테스트를 썼다면 red 단계에서 즉시 4건이 "경로가 존재하지 않는다"로 걸렸을 것이다. 지침의 가치가 실증됐다.
- **괴리 ② — S3(자체-app override)가 완전 no-op.** 감사 대상 5파일 중 대상 GET을 호출하는 것은 `test_macro_signals_batch.py`(L123 `/api/market/macro-signals`) 하나이고, 그 파일은 **이미** `get_current_user` override를 갖고 있었다(L122, task#169 `_block_real_db` 커밋에서 선재). 코드 변경 0으로 전체 green.
- **괴리 ③ — 로컬 pytest가 추적 대상 정적 데이터를 덮어썼다.** 전체 스위트 후 `backend/data/sp500_tickers.json`·`kospi_tickers.json`이 modified(mtime = 스위트 실행 시각). `tests/test_market_indicators.py`가 `universe.py`/`earnings.py`의 라이브 스크레이프를 태워 결과를 정적 참조 파일에 write. diff는 `ECHO`·`FDXF`·`HONA` 같은 비실존 티커를 넣고 `CPB`·`EPAM`·`POOL`·`CAG`를 빼는 품질 열위 스크레이프였다 → `git checkout --`으로 되돌리고 커밋에서 배제.
- **괴리 ④ — 문서 슬라이스를 1/3 관찰대로 선제 적용.** 계획엔 여전히 없었으나 1/3 run.md의 "착수 시 `불필요` 표기부터 확인" 관찰을 실행 → **4곳이 `Auth: 불필요`**(leverage·coverage·backfill/progress·lending), 13곳은 Auth 줄 없음 → 17곳 갱신.

## 학습

- **다음에 다르게 할 것(핵심) — 계획서의 *사실 주장*은 실행 전에 기계로 확인한다.** 경로·시그니처·의존성 같은 사실은 문서(계획·CLAUDE.md)를 읽는 대신 **배선을 열거**해 확정할 것: `.venv/bin/python -c "from routers.X import router; [print(r.path) for r in router.routes]"` 1회면 끝난다. 3/3이 이 순서를 지켜 경로 오류 0이었고, 2/3과 3/3의 차이를 만든 것은 이 한 가지다.
- **문서 간 불일치는 "어느 쪽이 코드인가"로만 깨진다.** CLAUDE.md와 API_SPEC.md가 어긋났을 때 판별 기준은 라이브 응답(200 vs 404)이었다. 오표기를 고칠 때 **왜 틀렸는지와 무엇을 잘못 유발했는지**를 함께 남겨(이 오표기가 task#231 계획을 틀리게 만들었다) 재발 시 추적 가능하게 했다.
- **부수 관찰 — 인증 게이팅이 해당 테스트 실행시간을 21.6s → 0.14s로 줄였다.** red 단계엔 무인증 요청이 핸들러를 지나 외부 fetch(yfinance·FRED·CNN)까지 갔기 때문. 성능이 목적은 아니지만 **"무인증 read가 외부 API 호출을 유발할 수 있었다"**는 실측으로 ADR-0029의 비용·레이트리밋 근거를 보강한다.
- **브라우저 커버 15/17** — 미커버 2개(`leverage/coverage`·`leverage/backfill/progress`)는 admin 백필 화면 소속으로 테스트 계정 접근 불가. 1/3의 `crawl/progress`와 같은 유형.

## 문서 갱신

- CONTEXT.md 승급: 없음
- ADR 추가: 없음 (3부작 종합 개정 노트는 ADR-0029에 반영 — 3/3 회고)
- 프로젝트 문서: `API_SPEC.md` 17곳 auth 표기(4곳 정정) + **`CLAUDE.md` lending 엔드포인트 경로 오표기 정정**(prefix는 `/api/market` 하나뿐임을 명시)
- CLAUDE.md 가토: 3부작 종합분으로 3/3 회고에서 일괄 승급
