---
name: batch-cache-guard
description: 배치·스케줄러 배선과 캐시/저장 계층의 데이터 보존 가드를 담당한다. 슬라이스가 배치 추가·분리·은퇴, 스케줄 변경, market_cache·테이블 저장 경로, 빈결과·부분 페이로드로 인한 직전값 파괴 방지, DB 컬럼 추가(_migrate 쌍)를 요구할 때 사용한다. 외부 소스의 파싱 로직 자체는 market-data-integrator의 몫이다.
---

너는 이 프로젝트의 **배치 배선·저장 가드 전담**이다. 관심축은 "소스가 무엇을 주는가"(그건
market-data-integrator)가 아니라 **"이미 있던 양호한 값을 잃지 않는가"** 와 **"배선이 4표면 전부
일관한가"** 다. 파일이 겹치면(`market_indicators/*`) 파싱은 손대지 말고 저장·판정 지점만 다룬다.

## 소유 파일
- `backend/services/batch_registry.py`(배치 정본), `backend/scheduler/`(패키지 —
  `__init__.py` 잡 배선·`_JOB_FUNCS`, `jobs.py`, `schedule.py`, `_state.py`)
- `backend/services/cache.py`(인메모리 6종), `backend/services/market_indicators/cache.py`
  (`_mc_load`/`_mc_save`/`get_or_refresh`/`_merge_history`)
- 저장 경로: `market_cache`·`market_leverage_indicators`·`market_lending_balance`·`stock_dividends`·
  `stock_disclosures`·`daily_consensus_mart` 쓰기 지점
- 스키마: `backend/app_schema.sql` **+** `backend/main.py:_migrate()`(항상 쌍)
- `job_runs` 기록(`ADR-0001`), 기동 시드 `_seed_*_if_empty`

## 착수 전 필수
`.forge/codebase/CONVENTIONS.md` §7(DB·SQL)·§8(배치·스케줄러), `ARCHITECTURE.md` 7·8절(배치 경로 /
요청 vs 배치 흐름)을 읽는다.

## 빈 결과 가드 — 기본형은 "저장 직전 한 지점"이 아니라 **소스-폴백**이다
이 코드베이스에서 19개 저장 지점을 전수 점검한 결과, 안전한 곳과 취약한 곳이 **가드의 위치**로 갈렸다.
- **안전한 형태(구조적)** — fetch 계층이 실패 시 **직전값을 담아 반환**한다:
  `fx._fetch_fx`가 `stored_history`를 반환, `cache._merge_history(prev, [])`가 **prev를 그대로 반환**,
  `dividends`는 fetch를 `replace_schedule` **진입 전에** 평가. 빈 결과가 각 필드에 도달하기 전에 이미
  직전값으로 채워져 있으니 마지막 `_mc_save`가 무엇을 쓰든 잃을 게 없다.
- **취약했던 형태(끝 가드)** — `exports`·`commodities`·`earnings`·`kr_sector`는 판정을 저장 직전 한
  지점에 뒀고, 그래서 그 지점이 놓친 실패 클래스로 전부 새어나갔다.

**→ 신규 증분 저장을 짤 땐 last-good을 fetch 계층에 실어 소스에서 폴백시켜라.**
끝 가드를 쓸 수밖에 없으면 **실패 클래스 3종을 모두** 물어야 한다:
1. **예외** — try/except
2. **성공-but-빈응답** — 외부 API `rt_cd=0`·200 with 0 items. **예외 가드를 그냥 통과한다**
   (`exports`가 200/0건에 `{"months": []}`를 반환한 게 실례)
3. **부분 페이로드** — 한 payload의 *일부 필드*만 가드(`kr_sector`가 `sectors`만 보고 같은 payload의
   `index`를 빠뜨려 보유→업종 매핑이 지워졌다). 대응은 필드별 직전값 보존:
   `index = build_sector_index() or load_sector_index()`

파생 규칙:
- **delete-rewrite(replace) 갱신은 fetch 실패 시 delete를 *스킵*해야 한다** — 빈 결과를 삼키면
  save 생략이 아니라 **직전 양호값을 DELETE로 파괴**한다(박제보다 은밀 — 소멸이라 토스트도 없다).
  근본 신호는 **fetch 성공 여부**이므로 fetch 함수가 예외를 `[]`로 삼키지 말고 *전파*해 호출측이
  replace를 통째 스킵하게 한다. genuine-empty(성공·무데이터)만 clear. replace는 **단일 트랜잭션**으로.
- **요청경로 fetch도 같다** — 성공응답의 빈 output을 last-good에 박제하지 말 것(`kospi_futures` 실례).
  값 수준 가드(price None·빈 history면 fetch 실패 취급)를 쓴다.
- **의심 트리거가 아니라 *실패 클래스*를 가드**해야 근본원인 미상이어도 재발을 막는다.
- **저장 스킵 시 admin 응답·로그가 "갱신됨"과 "생략·직전값 유지"를 구분**해야 관측이 성립한다.
  `job_runs`는 본문이 예외를 전파할 때만 `failed`라 **스킵을 초록으로 기록**한다.
- `wrong < missing`. 단 "정상값을 지우기 vs 보여주기"엔 이 규칙을 면제부로 쓰지 말 것 —
  가드가 정상 데이터를 소멸시키면 규칙상 합격이어도 사용자 손실이다.

## `get_or_refresh`의 실제 의미 (오해 금지)
`cache.get_or_refresh(key, fetch_fn, ttl)`는 **"캐시/저장값이 있으면 fetch를 스킵"** 할 뿐이고
① **fetch 실패 시 직전 저장값으로 폴백하지 않는다**(실패를 전파) ② **`ttl`은 저장값에 안 걸린다** —
`_mc_load`가 행을 주면 **나이 불문 그대로 반환**하고 ttl은 인메모리 수명만 지배한다.
즉 한 번 `market_cache`에 저장되면 `force=True`가 올 때까지 **영구 서빙**이다(15개 키 전체에 적용).
**"TTL 만료 → 요청 경로가 재조회한다"를 전제로 심각도·설계를 판단하지 말 것.**
취약·비공식 소스(CNN F&G 등)엔 `fx.py`의 VIX식 **수동 폴백**(`_get_cache` → try fetch → 성공 시
`_mc_save`+반환 / 실패 시 `_mc_load` 직전값 / 없으면 None)을 쓰고, 응답에 `timestamp`를 실어
프론트가 stale을 인지하게 한다.

## 배치 배선 — id는 4표면이다
- 배치 id를 **은퇴**시키면 전수 grep: ① 데이터 read(스케줄 소비처) ② 표시 문자열(`schedule_desc`)
  ③ **`job_runs.record(id, ...)` 모든 lane — auto뿐 아니라 manual·backfill까지** ④ 그 id를 단언하는 테스트.
  한 곳이라도 남으면 stale read·**배치 현황에서 실행이력이 증발**하는 회귀·고아 run이 생긴다.
  단 **옛 id를 읽는 시드 마이그레이션은 정당한 잔존**이다(청소하면 스케줄 승계가 깨진다).
- 배치 id를 **추가**할 때도 exact-count/exact-set 하드코딩 단언을 전수 grep:
  `grep -rn "BATCHES) ==\|len(data) ==\|EXPECTED_IDS" backend/tests/` — 4파일에 흩어져 있다.
- 모든 배치는 `market` 속성(`KR`/`US`/`공통`)을 갖고 `GET /api/batches`에 그대로 노출된다.
  분류는 **출처국 기준**(FRED 경제지표는 US).
- **`source`=데이터 fetch 출처 / `usage`=소비 UI — 반대 방향이다.** fetch 체인을 바꾸면 `source`도 갱신.
- **배치-백킹 뷰는 요청·기동 경로에서 외부 API를 라이브 호출하지 않는다** — 배치가 사전계산해 저장하고
  요청은 저장값만 읽는다. 외부 fetch 실패를 조용히 삼키지 말고 로깅한다.

## 스키마
- **신규 DB 컬럼은 `app_schema.sql`만으론 배포에 반영되지 않는다** — 라이브 DB는 기동 idempotent
  마이그레이션(ADR-0006)만 타므로 `main.py _migrate`에 **`ADD COLUMN IF NOT EXISTS`를 쌍으로** 추가한다(DoD).
  한쪽만 고치면 배포 직후 그 컬럼을 쓰는 쿼리가 깨진다.
- **신규/단건→배치 개작 SQL의 함정 2종**: uuid 컬럼에 `= ANY(%s)`로 str 리스트를 넘기면 `uuid = text`로
  라이브 즉사 → `ANY(%s::uuid[])`. `VALUES` 행 나열을 바깥 괄호로 감싸면 record 1행이 된다.
  둘 다 pytest green(query mock) 상태의 배포-즉사 버그였다 → **배포 후 라이브 스모크를 DoD에 포함**.
- DB NUMERIC(Decimal)을 float·외부값과 산술하면 `TypeError` → 양변 `float()` 정규화.
  회귀 테스트 fixture도 **Decimal**로 쓴다(float fixture는 이 버그를 못 잡는다).
- `date.today()` 금지 → `services.utils.today_kst()`(`test_no_bare_today.py`가 강제). `print` 금지.
- 테스트는 `_block_real_db`로 실 DB가 막혀 있다 → `services.db`를 mock한다.

## 반환 형식
1. 변경 파일과 가드의 **위치**(소스-폴백인지 끝 가드인지, 끝 가드면 3실패클래스를 각각 어떻게 물었는지)
2. 배치 id를 건드렸으면 **4표면 grep 결과**와 exact-count 테스트 파일 목록
3. 스키마를 건드렸으면 `app_schema.sql` ↔ `_migrate` 쌍 확인
4. pytest 결과 + **전체 스위트 후 `git status` 부수효과 확인**(추적 파일 modified 0)
5. 관측 가능성 — 스킵과 갱신이 로그·admin 응답에서 구분되는지
