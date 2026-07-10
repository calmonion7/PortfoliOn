# 0013 — 배치 시장 분류 축(국내/해외/공통) + earnings·monthly 시장별 분리

- 상태: 채택 (Accepted)
- 날짜: 2026-06-14
- 관련: task #46 (batch-market-tabs-split), ADR-0007(통합 batch_schedules·제너릭 에디터), ADR-0012(일일 리포트 시장별 분리), `.forge/CONTEXT.md` 배치 시장 분류

## 맥락 (Context)

배치 현황 허브는 14개 배치를 category(리포트·분석 / 시장 데이터 / 구루)로만 그룹핑했다. 실제 배치는 KR 전용(DART·KOFIA·키움)·US 전용(yfinance S&P)·양쪽 혼합·글로벌이 섞여 있어 **시장 관점의 탐색이 불가능**했다. ADR-0012는 `daily_report`만 시장별로 분리했지만(동인은 장마감 시각 정렬), 그 외 배치엔 시장 축이 없었다.

배치를 시장 관점으로 보면 셋으로 갈린다:
- **시장 귀속 명확 + 이미 시장별 독립 함수**: `earnings_refresh`는 한 잡이 `_fetch_and_save_m7_earnings()`(US)와 `_fetch_and_save_kr_top2_earnings()`(KR)를 순차 호출한다. `monthly_refresh`도 `_fetch_and_save_econ_indicators()`(FRED·US)와 `_fetch_and_save_kr_exports()`(KR)를 순차 호출한다. 데이터가 깔끔히 시장 귀속된다.
- **시장 귀속 불가**: `consensus`(daily_report에 내장, 한 종목의 market으로 분기·독립 잡 없음), `daily_digest`(한 유저 포트폴리오가 KR+US 합산) — 한 단위 안에서 시장이 엉켜 못 쪼갠다.
- **글로벌**: `guru_crawl`(dataroma 글로벌 스크레이프, 시장 무관).

## 결정 (Decision)

1. **시장 분류 축 도입** — 모든 배치에 국내(KR)/해외(US)/공통 속성을 부여한다. 허브 `배치` 탭 안에 이 3개 서브탭을 두고, **탭 안은 기존 category 섹션을 유지**한다(상단 `배치`/`권한·계정` 탭은 불변). 판정 기준은 **데이터 출처·주체 국가**(사용처 시장이 아님): KR 소스→국내, US 소스→해외, 시장 귀속 불가/글로벌→공통.

2. **earnings·monthly만 시장별 분리** — 시장 귀속이 명확하고 이미 독립 함수로 갈라진 배치만 분리한다:
   - `earnings_refresh` → `earnings_kr`(KR Top2) + `earnings_us`(M7)
   - `monthly_refresh` → `monthly_kr`(KR수출) + `monthly_us`(FRED 경제지표)
   - **FRED 경제지표는 해외**: 미 연준 데이터라 양 시장 매크로 신호지만 출처국 기준으로 해외에 둔다(M7과 같은 탭).
   - `consensus`·`daily_digest`·`guru_crawl`은 분리하지 않고 **공통**에 둔다.

3. **id 은퇴 시 4표면 전수 grep**(CLAUDE.md Gotcha·ADR-0012 학습): `earnings_refresh`·`monthly_refresh` 은퇴 시 ① 데이터 read, ② 표시 문자열, ③ `job_runs.record(id,...)` 전 lane(auto+manual), ④ 그 id를 단언하는 테스트를 모두 갱신한다. 수동 트리거는 랭킹 배치의 `?market=KR|US` 패턴을 따라 각 시장이 **자기 `*_kr`/`*_us` id로 기록**한다. 배치카드와 끊긴 고아 `/refresh-econ`은 `monthly_us`로 흡수(또는 은퇴).

4. **기동 시드 마이그레이션**(ADR-0006 idempotent _migrate): 기존 `earnings_refresh`·`monthly_refresh`의 `batch_schedules` 행(enabled·spec)을 두 신규 시장 배치에 **그대로 승계**한다. daily_report와 달리 장마감 시각 민감도가 없어(주/월 주기) **시각 override는 하지 않는다** — 배포 후 거동 불변(같은 시각에 같은 데이터, 단지 두 잡으로).

## 고려한 대안 (Alternatives)

1. **국내/해외 2탭(공통 없음)** — 양쪽·글로벌 배치가 집이 없어 양 탭 중복표시 또는 강제배정해야 한다. 기각(공통 탭이 깔끔, 사용자도 3탭 선택).
2. **earnings·monthly도 분리 안 하고 공통에** — id 은퇴 0으로 가장 저렴하나, KR수출·KR Top2 같은 명백한 KR 데이터가 공통에 박혀 시장 귀속이 흐려진다. 데이터가 이미 독립 함수로 갈라져 있어 분리가 개념적으로 옳다. 기각.
3. **consensus·digest도 시장별 분리** — 한 종목/유저 안에서 KR+US가 엉켜 분리 불가(consensus는 daily_report에 내장되어 이미 종목 market별 분기). 기각.
4. **분류 기준을 "사용처 시장"으로** — FRED econ은 양 시장 판단에 쓰여 공통이 될 수도 있어 모호. "데이터 출처국" 단일 기준이 더 일관·명확. 기각.

## 결과 (Consequences)

- 배치 14→16. `GET /api/batches`가 `market` 필드를 노출하고 프론트가 시장 서브탭으로 필터한다.
- `earnings_refresh`/`monthly_refresh` id 은퇴 → 실행이력·스케줄 행 마이그레이션 필수. **미이행 시** ADR-0012 분리 retro의 "수동/백필 record가 은퇴 id로 → 카드에서 증발" 회귀가 재발한다(이 ADR이 그 함정을 기록).
- 수동 트리거 엔드포인트가 시장별로 갈라진다(또는 `?market=`). **API_SPEC.md 갱신**(배치 목록·수동 엔드포인트). CLAUDE_COWORK_API.md는 배치/스케줄 id를 참조하지 않아(admin 내부용) **무변경** — "명세서 2개 동기" 규칙의 정당한 단일 갱신.
- 분류 규칙이 "데이터 출처국"이라, 향후 다른 글로벌 매크로 배치(VIX·국채 등)도 출처가 US면 해외로 일관 분류된다(사용처 기준 아님을 명시).
- 공통 탭이 "시장 귀속 불가" 버킷을 제공 → 신규 배치 추가 시 국내/해외/공통 판정 기준이 생긴다.
- 향후 제3시장(예: 도쿄) 추가 시 같은 축으로 확장 가능.
