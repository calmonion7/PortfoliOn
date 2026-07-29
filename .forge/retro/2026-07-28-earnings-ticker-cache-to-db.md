<!-- forge-slug: earnings-ticker-cache-to-db -->
# 2026-07-28 — earnings 티커 캐시를 파일 → market_cache로 이동 (task#234)

일괄 승급으로 사후 작성(2026-07-29, `fg-next all` 드라이브가 자동 skip한 분).
직접 실행 · tdd on · 배포 `306755f` · 백엔드 pytest **1380 passed**

## Plan vs actual

S1~S4 전부. 7일 캐시를 `market_cache`(키 `sp500_tickers`·`kospi_tickers`)로 옮기고 `backend/data/*.json`을 **read-only 폴백 시드**로 격하 — `earnings.py`의 `backend/data/` **write 경로 0**(`json.dump`·`makedirs`·`open(...,"w")` grep 0건).

### Divergences

- ① **⚠️ 계획의 심각도 근거가 사실과 달랐고, 원래 회고가 더 정확했다.** 계획은 "`get_or_refresh(..., 86400)`이라 TTL 1일이 지나면 인증 사용자의 GET 한 번이 스크레이프+파일 write를 유발한다"며 회고를 *정정*했는데, `cache.py`를 직접 읽으니 **`get_or_refresh`는 저장값에 age 체크가 없다** — `_mc_load`가 행을 주면 나이 불문 그대로 반환하고 `ttl`은 **인메모리 캐시 수명만** 지배한다. 라이브에서 3일 지난 `m7_earnings`가 2ms에 반환돼 재확인. 실제 write자는 ⓐ 로컬 pytest(`_block_real_db`가 DB를 막아 미스→`fetch_fn`→스크레이프→파일 write) ⓑ 주 1회 배치의 `force=True`뿐이었다.
- ② `_SP500_CACHE`→`_SP500_SEED` 개명(계획 밖) — 역할이 캐시→시드로 바뀌었으니 이름이 거짓말하지 않게 하고, 남은 stale 참조가 조용히 통과하지 않고 `AttributeError`로 터지게 한다.
- ③ 계획에 없던 방어 3건 — `fetched_at` `TypeError` 가드 / 신선하지만 **티커가 빈 저장값은 미스로** 취급 / 실패 시 만료 저장값 → 정적 시드 순 폴백.
- ④ **red가 "의미 있는 red"는 아니었다** — `_seed_state()`가 존재하지 않는 심볼을 먼저 읽어 9건 전부 `AttributeError`로 죽었다(덕분에 시드 오염 0이었지만 "옛 구현이 실제로 write한다"를 red 단계에서 관측하진 못함). green 후 **공허성 검증**으로 대체: 시드를 tmp에 복사·패치해 옛 동작을 재현하니 테스트가 기대대로 실패.
- ⑤ **DoD 증거를 계획보다 강하게 만들었다.** "전체 스위트 1회 후 `git status` 깨끗"은 **약한 신호**다 — 시드 mtime이 신선하면 옛 구현도 스크레이프를 스킵해 깨끗하게 나온다(task#233 ⑥의 "미재현"의 정체가 바로 이것). **시드 mtime을 8일 전으로 되돌려** 전체 스위트를 재실행해 write 0을 확인했다.
- ⑦ **CLAUDE.md 가토의 사실 오류를 정정** — 가토가 `universe.py`·`earnings.py` 둘을 write자로 지목했으나 `universe.py`는 `open()`으로 **read만** 한다. 실제 write자는 `earnings.py` 하나.
- ⑧ CLAUDE.md 2곳 갱신(계획에 문서 슬라이스 없었음 — task#230·231·232가 반복한 패턴이 또 나왔다).
- ⑨ `_BASE_DIR` 미사용 import는 **기존 dead code**라 제거하지 않음(§3 준수). `time` import는 내가 지운 코드가 유일 사용처라 함께 제거.

## Learnings

- **Do differently next time**:
  - ⭐ **`get_or_refresh`의 `ttl`은 저장값에 안 걸린다 — 한 번 저장되면 `force`까지 영구 서빙**(①). 15개 키 전체에 적용되는 구조적 사실이고 이름·인자가 오해를 부른다(`econ_indicators` 07-10·`kr_exports` 07-15가 그대로 서빙되는 것과 일치). **계획이 코드를 안 읽고 회고를 "정정"하다 더 틀렸다** — 심각도 근거를 바꿀 땐 소스를 직접 읽을 것.
  - ⭐ **mtime을 TTL 기준으로 쓰면 덮어쓴 직후 mtime이 신선해져 증상이 스스로 숨는다**(⑤). "간헐 발생"으로 보이면 **캐시 신선도 판정이 자기 자신을 갱신하는 구조인지** 볼 것. 그리고 그런 증상의 DoD는 "1회 실행 후 깨끗"이 아니라 **은폐 조건을 인위적으로 제거한 뒤** 확인해야 한다.
  - **TDD의 red가 `AttributeError`로 죽으면 그건 의미 있는 red가 아니다**(④) — 옛 동작을 재현하는 **공허성 검증**을 green 후에 별도로 돌릴 것.
  - **역할이 바뀐 심볼은 개명해 stale 참조가 조용히 통과하지 않게**(②).
- **후속 후보(미해결)**: ① 어느 테스트가 실제로 파일 write를 유발했는지 미규명(경로는 없앴으므로 기능적으로는 무관) ② **`get_or_refresh`에 저장값 age 체크가 없는 것이 의도인지 판단 필요** — 이름·인자가 오해를 부른다.

## Doc updates

- CONTEXT.md promotion: 없음. ADR added: 없음.
- **프로젝트 `CLAUDE.md` 갱신(실행 중 2곳)**: `market_cache` 키 목록에 신규 2개 추가 · task#231 오염 가토를 "해결됨 + 남는 교훈"으로 재작성(⑦ 정정 + mtime 자기은폐 일반 교훈 포함).
- **추가 승급(사용자 승인, 일괄 승급 2026-07-29)**: `get_or_refresh` 가토에 **"저장값엔 age 체크가 없다 — ttl은 인메모리 수명만 지배, 저장되면 force까지 영구"**.
