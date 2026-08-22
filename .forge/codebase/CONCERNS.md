---
last_mapped_commit: 20dd46eb829b05025af793b010dfe4efe2925a7d
mapped: 2026-08-10
---

# CONCERNS — 기술부채·버그·리스크 지도

이 문서는 **구현 사실**만 담는다. 용어 정의는 `.forge/CONTEXT.md`, 결정의 근거는 `.forge/adr/`에 있다.

각 항목은 다음 4개 중 하나로 표시된다. **과장 금지** — 가드된 설계 선택을 열린 버그로 승격하지 않고, 이미 고쳐진 것을 열린 것처럼 쓰지 않는다.

| 표시 | 뜻 |
|---|---|
| **확인된 버그** | 코드를 직독해 재현 경로가 확정된 결함. 도달 조건도 함께 적었다. |
| **잠재 위험** | 지금 깨져 있지는 않으나, 특정 입력·외부 변화·재실행에서 깨진다. |
| **설계상 트레이드오프** | 의도된 선택(대개 ADR 근거 있음). 비용을 알고 쓰라는 뜻. |
| **이미 가드됨(잔여 위험만)** | 과거 사고가 코드로 막혔다. **재제기 금지** — 남는 잔여만 적었다. |
| **미확인** | 이번 패스에서 코드로 확정하지 못했다. 근거 부족인지 도구 범위 밖인지 함께 적었다. |

이 판은 **HEAD `20dd46e` 시점의 코드에서 전면 재작성**했다. 직전 판(`4752112`, 07-31)을 베이스라인으로 쓰지 않았고, `CLAUDE.md`의 Gotchas 산문은 *리드 목록*으로만 썼다 — 각 항목을 코드로 재확인해 확인된 것만 실었고, 확인되지 않은 것은 §13에 "미확인"으로 분리했다.

> ⚠️ **섹션 번호를 함부로 바꾸지 말 것.** 코드 주석 8곳과 `API_SPEC.md`가 `CONCERNS §N`을 직접 인용한다. 이번 판은 대분류(§0~§14) 번호를 직전 판과 **동일하게 유지**했다. 인용 중 어느 것이 이미 stale한지는 §12.6에 실측으로 정리했다. 항목 추가는 하위번호(§N.M)로.

> 🔒 **이 문서는 git 추적 대상이다** — 실제 키·토큰·비밀번호 **값**은 쓰지 않는다. 환경변수 *이름*만 적는다.

**이번 판에서 반증된 전제 3건** (지시문·직전 판이 참으로 놓았으나 코드가 다르게 말한다):
1. `services/db.py::get_connection`은 **롤백 경로가 있다**(`except Exception: conn.rollback(); raise`). "정상 종료 시 커밋한다"는 맞지만 "롤백 전제 코드가 성립하지 않는다"는 **틀렸다** — §4.3.
2. `short_sell_service`·`investor_service`·`lending_service`·`leverage_service`는 **delete-rewrite가 아니다**(전부 append-only upsert). 빈 fetch가 이미 안전한 no-op이다 — §1.4.
3. 무인증 엔드포인트는 여전히 **정확히 9개**이고 전부 `routers/auth.py` 소속이며, `tests/test_no_public_reads.py`의 allowlist와 **양방향으로 일치**한다(드리프트 0) — §5.1.

---

## 0. 지금 열려 있는 확인된 버그

번호는 지난 매핑과 **연속**이다(해소된 것의 번호는 재사용하지 않는다). 이번 판은 아래 표의 전 항목을 `20dd46e` 코드로 **직접 재확인**했다. 직전 판에 있었으나 이번에 재검증하지 못한 항목은 §13.2에 "미확인"으로 분리했다 — 표에서 사라졌다고 해소된 것이 아니다.

> **재검증: 2026-08-11 (task#292) — 이 절과 §13.2만 갱신됨.** 9차 버그 헌트(`4325d8d..b93afce`, 56커밋/179파일, 7렌즈 + LC 판정 레인)가 확정한 **B51~B59**를 추가하고, `§13.2` 미확인 8건을 판정해 **열림으로 확정된 6건을 이 절로 이동**했다(기존 번호 복귀 `B8`·`B30` + 무번호였던 4건에 신규 번호 `B60`~`B63`). `last_mapped_commit` 프론트매터는 건드리지 않았다(재매핑이 아니다). 근거·검증방법·제안수정은 `.forge/bug-report.md`(9차) 참조.

> **해소: 2026-08-16 (task#303) — B60·B61 닫힘.** 근거: `.forge/adr/0040-timeseries-outlier-filter-display-only.md`. **B60**은 저장/표시를 분리해(`_yf_close_history`가 필터되지 않은 병합·트림본을 저장용으로 반환, 필터는 응답 `history`를 만드는 자리에서만 적용) 닫혔고, 판정축도 「1년 창 중앙값 대비 5배」→「고립 스파이크(한 점이 양 이웃과 모두 어긋나되 이웃끼리는 서로 정합, 첫 점은 단일 이웃 비교, 최신 점은 비교 대상에서 제외)」로 교체해 지속적 국면전환(`^IRX` 0.03%→4.5%류)을 더는 자르지 않는다. **B61**은 `services/market/kr.py::_naver_row_val`이 위치 인덱스 대신 `rowList`의 `title` 문자열로 행을 찾도록 바꿔 닫혔다(위치 인덱스 소비처 잔존 0 — `kr.py` 2곳·`report_generator.py` 1곳 전환 완료), title 미발견은 `None` + `logger.warning`(인덱스 폴백 없음, wrong<missing). 둘 다 회귀 고정 4축·title 매칭 축이 test-first로 신설됐다(`backend/tests/test_market_indicators.py`·`test_financials_kr.py` 등). **번호는 재사용하지 않는다** — 아래 표에서 행만 제거한다.
>
> ⚠️ **같은 태스크의 적대적 검토가 새 판정축에서 결함 3건을 확증해 in-run으로 보강했다**(그대로 뒀으면 B60이 변형으로 재발했다). ⓐ **비양수 점 사각** — 비율 계산이 `a<=0 or b<=0`에서 무조건 「정합」을 반환해 값이 정확히 `0`이거나 음수인 점(yfinance 결측 경로)이 어느 위치에서도 안 걸렸다. 옛 중앙값 필터는 `median>0`인 한 `v<=0`을 **항상** 배제했으므로 이건 새 판정이 만든 **신규** 사각이다 → 한쪽만 비양수면 `inf`(완전 불일치), 둘 다면 `1.0`. ⓑ **선두 쓰레기 런** — 쓰레기 점이 1개가 아니라 **2개 연속**이면 그 둘이 서로 정합해버려 「이웃끼리 정합」 조건이 통째로 무력화된다(원 버그의 재발 경로) → 선두만 본문 중앙값과 대조해 자릿수가 다른 동안 벗겨내는 `_LEAD_ABSURD_RATIO=50` 가드를 추가했다. 임계 50은 지속 이동의 중앙값 대비 최대 이탈(`^IRX` **12배**)과 실측 쓰레기(**2143배**·**10450배**) 사이에 둔 값이라 지속 이동엔 무반응이다(그 무반응 자체가 별도 회귀축이다). ⓒ **저장 raw의 응답 누출** — 저장 전용 `_raw_history`가 `get_fx`/`get_vix`/`get_commodities`/`get_indices` 반환 dict에 남아 라우터가 그대로 echo했다. 응답 shape 변경(계획 비목표 위반)이자 ADR-0040이 가리기로 한 쓰레기 점을 공개 API로 내보내는 경로였다 → `cache._public()`으로 저장 직후 벗긴다(treasury의 `_raw_histories`는 **이번 변경 이전부터 있던 키**라 건드리지 않는다 — 없애는 것도 shape 변경이다). 부수로 배포 직후 구버전 blob에 새 키가 없는 창에서 개별 백필이 빈 리스트를 잡아 심볼이 통째 사라지던 경로도 구키 폴백으로 막았다.

> **재검증: 2026-08-21 (task#325) — 이 절과 §13.2만 갱신됨.** 10차 버그 헌트(A 신규범위 `b93afce..0262e39` 130파일 + B 오래안본 서브시스템 glob 42파일 + C `§0` 전수 재판정 31건, 8렌즈 + C 판정 4분할 = 12병렬)가 확정한 **B64~B79**(16건: HIGH 2 · MEDIUM 5 · LOW 9)를 추가했다. **C 레인이 이 절의 열린 29건을 전수 재판정한 결과 닫힌 것은 0건이다** — 열림 28 · **부분 1**(`B57`, 도달조건 축소로 재서술) · 판정불가 0, 위치는 전건 제자리. `B60`·`B61`은 블라인드 대조군으로 되섞어 판정했고 **닫힘이 재확인**됐다(표에 행을 되살리지 않는다). `last_mapped_commit` 프론트매터는 건드리지 않았다(재매핑이 아니다). 근거·검증방법·제안수정·후속 우선순위는 `.forge/bug-report.md`(10차) 참조.
>
> ⚠️ **이 사이클이 비목표의 전제를 반증했다** — 계획은 「프론트 시각 렌즈를 두지 않는다(그 21파일은 프로브가 덮었다)」를 비목표로 두고 **그 전제를 A4 렌즈가 직접 재도록** 설계했는데, 전제가 **부분적으로 거짓**이었다(`B78`·`B79`). 즉 `components/tech/*` 일부는 「사각인데 사각이 아닌 척하는 상태」에 가깝다. 또 `§8.1` 인메모리 캐시 스레드 안전성의 **3사이클 연속 이월이 끊겼다** — `threading.Barrier` 하니스를 실제로 만들어 재현해 `B69`로 확정했다(비용은 몇 줄이었다).

> **해소: 2026-08-22 (task#326) — B19·B72·B73·B74 닫힘.** 10차 확정분 수정 1/7(계약·보안 4건). **B19**는 `routers/auth.py::_hmac_secret`으로 임포트타임 바인딩 + 리터럴 폴백을 없애고 *호출 시점* 해석으로 바꿔 닫혔다 — 미설정이면 서명하지 않고 `RuntimeError`로 실패한다(임포트타임 raise는 하지 않는다: `main.py` 밖 진입점의 임포트를 통째로 막기 때문). 백엔드에 하드코딩 시크릿 폴백 잔존 **0건**(§5.5·§10.5 갱신). **B72**는 GitHub 콜백에 ⓐ 최상단 `error` 파라미터 체크 ⓑ `access_token` 부재 ⓒ 프로필 응답 형태 ⓓ 이메일 확정 실패 4가드를 넣어 전부 `?error=oauth_denied|oauth_failed`로 프론트에 되돌리고, `main.py`에 전역 `Exception` 핸들러를 신설해 raw `text/plain` 500을 `{"detail": "Internal Server Error"}` 고정 본문으로 바꿨다(`HTTPException`·`RequestValidationError`는 별도 키라 삼키지 않는다). ⚠️ **종단(실제 GitHub 인가 화면 «취소») 확인은 라이브 OAuth라 이 루프가 실행하지 않았다 — 사용자 확인 대기.** **B73**은 `backend/auth.py::get_current_user_or_api_key`를 진짜 OR로 바꿔 닫혔다(둘 다 유효하면 키 우선, 키만 틀리면 기존 `detail="Invalid API key"` 유지). **B74**는 `routers/auth.py`의 `ALL_MENUS`에서 6번째 키 `analysis`를 제거해 4소스(`routers/admin.py`·`PermissionPanel.jsx`·`app_schema.sql` 시드)를 일치시켜 닫혔다(ADR-0025 「5키 불변」). **번호는 재사용하지 않는다** — 아래 표에서 행만 제거한다.
>
> ⚠️ **이 절의 규율 재확인 — 사라졌다고 해소된 것이 아니다.** 같은 파트가 비목표로 남긴 `B9`·`B20`·`B21`·`B48`·`B51`·`B63`은 **행을 그대로 유지**했다(task#333/#334로 이월). 특히 `B20`(레이트리밋)은 이 파트가 같은 파일 `routers/auth.py`를 만졌으므로 「같이 고쳐졌겠지」로 읽히기 쉬운데, 고치지 않았다.

> **해소: 2026-08-22 (task#327) — B78·B79 닫힘.** 10차 확정분 수정 2/7(**죽은 라이브 계기 2종 복구**). 두 결함은 같은 클래스였다 — **주석에 적힌 데이터 상태 주장이 썩었는데 그 주장이 `if`의 근거로 쓰이고 있었다**(주석이 코드 경로를 가두면 그 주석은 테스트 없는 코드다). **B79**는 `scripts/uat298-tech-structured.mjs`의 real 모드가 「실발행물엔 `variants`·`watch_items`가 NULL이다」를 하드 전제로 `absent-*` 3축에 ABSENT를 단언하고 `continue`해 상세 렌더 블록을 **영원히 도달 불가**로 만든 것이다. 라이브 census(목록 GET + slug 15개 개별 GET 대조) 실측 — 발행 **15종 전부** `variants` 채워짐 · `watch_items` **15/15 정확히 5건**. 3축을 「NULL이어야 한다」가 아니라 **「렌더가 그 발행물의 실제 데이터와 일치한다」(양방향)**로 재작성하고 `continue`를 제거해 닫혔다: **284건 / FAIL 24 / exit 1 → 544건 / PASS 544 / FAIL 0 / exit 0**. **B78**은 `scripts/uat282-tech-structure.mjs`의 「시장 규모 추정치」 상세 13축이 `if (R.mode === 'inject')`에 갇혀 라이브를 전혀 안 재던 것으로, 게이트를 **모드가 아니라 런타임 데이터 판정**으로 바꿔 닫혔다: **1738건 / FAIL 4 → 1885건 / FAIL 4**(선재 4건은 태그까지 동일 — 아래 참조). 총계 증가가 「축이 실제로 라이브에 도달했다」의 증언이다 — **FAIL 0만 보면 미실행과 구별되지 않는다.** **번호는 재사용하지 않는다** — 아래 표에서 행만 제거한다.
>
> ⚠️ **재발 시 자동 신호를 신설했다.** B78·B79가 무기한 생존한 이유는 「축이 조용히 스킵돼도 총계가 줄지 않는다」였다. 그래서 ⓐ **실행 판수 카운터**(`real-detail-runs-variants`·`real-detail-runs-watch-items`·`est-real-domain`)와 ⓑ **라이브 표본 하한**(`est-live-sample`·`live-sample-variants`·`live-sample-watch-items`, 정확일치 금지 — 발행 수는 정당하게 변한다)을 전역 축으로 두었다. 게이트 드리프트는 ⓐ가, 라이브 데이터 소실은 ⓑ가 각각 **이름으로 갈라** FAIL한다(주입으로 양방향 실증). 판정을 「소실」과 「드리프트」 중 하나로 뭉치면 다시 눈이 먼다.
>
> ⚠️ **`uat282`의 `exit 0`은 여전히 도달 불가하다 — 정지조건으로 쓰지 말 것.** 선재 FAIL 4건(`caption-lines` pc1440/`reusable-rocket` ×2 · `overflow-leaf` m350-dark/`smr` ×2)은 이 파트의 범위 밖이라 그대로 두었다. 게이트는 **「FAIL ≤ 4 AND 단언 총계 ≥ 1885 AND 책임 축 FAIL 0」** 3항으로 쓴다(`uat298`은 선재 FAIL 0이므로 「FAIL == 0 AND 총계 ≥ 544」로 쓸 수 있다).
>
> ⚠️ **이 절의 규율 재확인 — 사라졌다고 해소된 것이 아니다.** 이 파트의 비목표가 「계기를 복구한 뒤 새로 드러나는 FAIL을 고치지 않는다 — 그것은 성과이고 부채가 아니다」였고, 실제로 **새로 도달한 축 36개 + S5 신설 전역 sentinel 5개 = 41개 전부 PASS라 인계 FAIL은 0건**이다(`.forge/handoff-327-to-331.md`에 그 사실과 근거를 기록했다 — 「인계 0건」과 「목록을 안 만들었다」는 다르다). 이월 6건 `B9`·`B20`·`B21`·`B48`·`B51`·`B63`은 **행을 그대로 유지**했다(task#333). 이 파트는 프로브·문서만 만졌으므로 프론트·백엔드 결함은 하나도 닫히지 않았다.

> **해소: 2026-08-22 (task#328) — B52·B62·B64·B66·B67 닫힘.** 10차 확정분 수정 3/7(**외부 파싱 실패가 오값으로 위장되는 경로 5건**). 다섯은 한 클래스였다 — **실패를 `None`이 아니라 *그럴듯한 값*으로 접는다**(`wrong < missing` 위반). **B62+B64**(`_table_unit`의 두 실패 경로)는 함께 닫혔다: 기본값 상수를 `_DEFAULT_UNIT="억원"` → `_UNKNOWN_UNIT="기타"`(비KRW이므로 `_is_krw` False → 자동추출 차단 → pending)로 바꾸고, 무제한 `find_previous`를 **비공백 문자열 노드 3개 유계 탐색**(`_UNIT_CAPTION_LOOKBACK`)으로 좁혔다. 반환은 **3-상태**가 됐다 — 확정 KRW / `"기타"`(캡션은 있으나 확정 실패, 호출측 산문 폴백을 **막는다**) / `None`(캡션 부재, 이때만 폴백 허용). ⚠️ 그 구별이 없으면 옛 코드가 *정확한* 단위를 냈던 입력에서 새 코드가 본문 산문의 무관한 통화 낱말을 채택해 **B62 클래스가 pending 라벨 경로로 재도입**된다. 부수로 **접미사 매칭 함정**을 함께 닫았다: 옛 `단위[^)]*?(조원|억원|…)`은 lazy 확장이라 `십억원`→`억원`(×1/10)·`만원`→`원`(×1/10,000,000)을 `_is_krw` True로 **자신 있게 틀리게** 저장했다(실 DART에 `십억원` 29건 실재 → 화이트리스트 `_EOK_FACTOR`에 factor 10.0으로 정식 추가, 그 밖 복합단위는 미확정). `market/kr.py::_rd_unit`도 같은 무제한 역탐색이었고 `_table_unit` 재사용으로 전환했다. **B66+B67**은 시세 전용 파서 `_close_price`(실패·비유한·**리터럴 0** → `None`)를 분리해 닫혔다 — 수량·금액은 `0` 폴백을 유지한다(순매수·거래량 0이 유효값). 같은 컬럼 writer가 셋이라 **Naver 폴백 경로(`investor_service.py::_parse_close_price`)까지 함께** 고쳤다(소스별로 0과 None이 섞이면 어느 쪽이 결함인지 코드로 판정할 수 없다). **B52**는 `run_daily`의 KR `AVG_PRC` override 게이트를 `if kr.get("target_mean"):` → `if tm is not None and math.isfinite(tm) and tm > 0:`으로 바꿔 닫혔다(`bool(float('nan'))==True`라 진리값 가드는 NaN을 통과시키고 음수도 truthy였다) + 소스층 `get_analyst_data_kr`의 `TARGET_PRC`/`AVG_PRC` 파싱에 `math.isfinite` 쌍 가드 = 2겹. **번호는 재사용하지 않는다** — 위 표에서 행만 제거했다.
>
> ⚠️ **`upsert_raw_reports`의 초크포인트는 시간 비대칭이라 그것만으로 부족했다.** 그 정규화는 *이번 실행이 다시 INSERT하는 행*(`days=7`)에만 걸리는데 `_MART_SQL`은 **90일 윈도우**를 집계하고, PostgreSQL `numeric`은 `NaN`을 저장한다 → 초크포인트 도입(2026-08-04) 이전 적재분이 아직 윈도우 안에 있다. 그래서 마트 3집계를 `NULLIF(target_price,'NaN'::numeric)`로 감쌌다(라이브 실측 `AVG/MAX/MIN over {NaN,100,200} = (NaN, NaN, 100)` — numeric NaN이 최대값으로 정렬돼 MIN만 무해하므로 셋을 함께 감싼다). **초크포인트는 「새 행」을, `NULLIF`는 「이미 있는 행」을 막는다 — 둘 다 필요하다.**
>
> ⚠️ **적대적 검토가 in-run으로 인접 2건을 더 닫았다**(둘 다 §0 번호가 없던 항목이라 표에는 없다). ⓐ **랭킹 `price`** — `_parse_int`가 시세에도 쓰여 실패를 `0`으로 접고 US 경로의 `quote.get("regularMarketPrice") or 0`은 `bool(nan) is True`라 NaN을 통과시켰다(뒤이은 `int(price*volume)`가 US 랭킹 배치를 통째로 죽였다) → 시세 전용 `_parse_price`(실패·비유한·리터럴 0 → `None`)를 분리. `§3.4`가 서술한 위험도 이때 함께 닫혔다. ⓑ **US 애널리스트 목표가** — `get_analyst_data`가 yfinance `analyst_price_targets`의 비유한값을 그대로 실어 mart뿐 아니라 **스냅샷**(`snapshots.data` jsonb)으로도 흘려보냈다 → `_finite()` 필드별 가드.
>
> ⚠️ **이 절의 규율 재확인 — 사라졌다고 해소된 것이 아니다.** 이월 6건 `B9`·`B20`·`B21`·`B48`·`B51`·`B63`은 **행을 그대로 유지**했고 이번 파트가 하나도 건드리지 않았다(task#333/#334). 특히 `B63`(프론트 포매터 중복)은 이 파트가 「표시측 `fmtPrice`가 null을 `'—'`로 처리한다」를 문서에 인용했으므로 「같이 정리됐겠지」로 읽히기 쉬운데, 포매터 중복 자체는 손대지 않았다.

> **해소: 2026-08-22 (task#329) — B1·B30·B40·B41·B43·B65 닫힘 + B6 부분.** 10차 확정분 수정 4/7(**빈 결과 가드가 없거나 스스로 꺼지는 저장 경로 6건 + 관측성**). 여섯은 한 클래스였다 — **`if not X:` all-or-nothing 게이트만 두어 「전부 실패」는 막고 「대폭 축소」는 무검증 저장**한다(실패율 2%에서 전부 실패 확률이 사실상 0이므로 그 가드는 **발동하지 않는다**). 처방을 집합 성격으로 갈랐다: **B65**(추천 배치)·**B1**(KR 랭킹 페이지)은 **유동 대규모 집합 → 커버리지 임계**(`MIN_SCORED_COVERAGE=0.5` 분모는 반드시 `len(candidates)` / `_MIN_PAGE_COVERAGE=0.5`), **B43**(US 섹터 11 ETF)은 **독립 항목 → 실패분 개별 백필**(형제 `kr_sector` 미러, 매칭 키는 `code`가 아니라 `etf`), **B30**(티커 유니버스)은 **축소 하한** `_TICKER_MIN_RETAIN=0.9`(기준을 정적 시드가 아니라 직전 저장값으로 잡았다 — 시드 기준은 라이브 규모와 어긋나 정상 스크레이프가 하한을 영구히 통과 못 하는 **자기교착**을 만든다). **B1은 delete-rewrite라 담아둘 last-good이 없어** 소스-폴백의 대응물로 **예외 전파**를 썼다(호출측이 `replace`를 통째로 건너뛴다). **B41**은 `fx_fetch` 배치 신설(매일 06:40 KST, `market="공통"`, 수동 `POST /api/market/refresh-fx`)로 닫혔다 — 신선도 판정 축은 rates 커버리지가 아니라 **새 종가가 붙은 심볼 수**다(`_fetch_fx`가 소스-폴백이라 전멸에도 rates는 채워진다). **번호는 재사용하지 않는다** — 위 표에서 행만 제거했다.
>
> ⚠️ **네 번째 실패 표면을 찾았다 — 가드의 *baseline*을 관용 로더로 읽으면 그 가드가 스스로 꺼진다(B40의 일반형, §1.8 신설).** `cache.py::_mc_load`가 조회 예외를 `None`으로 접으므로 **「DB 오류」와 「저장 없음」이 같은 값**이 되고, 완전성·커버리지·축소 가드는 전부 직전 저장값을 기준으로 판정하니 **기준이 0으로 붕괴해 판정이 항상 통과**한다. 가상의 위험이 아니다 — `_mc_save`는 `execute`·`_mc_load`는 `query`라 **SELECT만 실패하고 INSERT는 성공하는 조합이 성립**한다(그러면 3종목이 503종목을 덮는다). 처방은 `_mc_load_strict`(조회 실패 전파, 행 부재만 `None`)이고 `_mc_load`는 **additive로 보존**했다(앱 36곳·18모듈 + patch하는 테스트 17파일의 계약 불변). 소비 4곳 중 `earnings._tickers_with_cache`만 전파하지 않고 `baseline_known=False`로 **저장만 생략**한다 — 폴백 체인을 가진 read 경로라 전파하면 일시 DB 오류가 배치를 죽인다(**가드가 정상 동작을 지우면 그것도 손실**이다).
>
> ⚠️ **관측성을 함께 배선하지 않으면 이 가드들은 전부 무음이다.** 소스-폴백 가드가 든 함수는 **설계상 절대 raise하지 않으므로** `with job_runs.record(id, trigger):`와 그대로 붙이면 전 계열 실패도 매 실행 `success`로 기록된다. 그래서 상태를 **반환값에 실어**(`_status`/`status`) auto·manual **두 레인 모두** `as run`으로 받게 했다 — **배선 1개 → 14개**(미배선 18, §6.1에 job id 전수). 메타는 `_mc_save` *뒤에* 새 dict로 붙여(`{**merged, "_status": …}`) 저장 캐시를 오염시키지 않는다. admin 응답도 `ok = (status == "success")`로 「갱신됨」과 「생략」을 구분한다(`sectors: 11`·`rate_count: 3`은 **저장 여부와 무관**하게 채워지므로 건수만 돌려주면 실패가 성공으로 읽힌다).
>
> ⚠️ **B6은 닫지 않았다 — 3위치 중 2곳만 닫혀 행을 *축소해* 남겼다.** `econ.py` + `_refresh_monthly_us`(+수동 2레인)는 닫혔으나 **`macro.py::_fetch_and_save_macro_signals`는 무변경**이고 그 두 레인(`_refresh_macro_signals` · `refresh_macro_signals`)은 **`as run` 미배선**이라, `FRED_API_KEY` 미설정 시 `macro_signals_fetch`는 **지금도 매 실행 success**다. 같은 wave가 형제 `econ.py`를 참조 구현으로 만들어 두었으니 이식 비용은 작다(§6.1 · 우선순위 6). **「같은 결함 가족을 고쳤으니 형제도 고쳐졌겠지」로 읽지 말 것** — 이 행이 남은 이유가 정확히 그것이다.
>
> ⚠️ **선재 stale 3건을 함께 정정했다**(이 wave가 만든 것이 아니다). ⓐ **`commodities.get_treasury()`의 「백필 → 판정」 순서 결함은 task#269(`e88e9c2`)에 이미 교정됐는데** `§1.7`·`CONVENTIONS §1.3`·`INTEGRATIONS §10.2` 세 곳이 옛 서술을 유지해 **「참조 구현으로 고르지 말 것」이라는 *지시*가 근거 없이 살아 있었다** — 실측 결과 `commodities.py::get_commodities`·`::get_treasury` 둘 다 백필 앞에서 raw 결과를 판정한다. ⓑ 배치 개수 서술이 문서 5곳에서 `20`·`29`로 갈렸다 → 전부 **33**(KR 16 · US 11 · 공통 6), `_JOB_FUNCS`는 **32**(차집합이 정확히 `{consensus}`). ⓒ `TESTING.md §5.6`·`§9.4`가 개수 단언을 **「3파일 3지점」**이라 적었으나 실측은 **「4파일 8지점」**이고, 그 절이 못박은 탐지 grep은 `set(…) ==`·dict 리터럴에 블라인드해 **4지점을 원리적으로 못 본다**(「감사 패턴을 좁히면 그 감사는 통과해도 무의미하다」의 배치 id판).
>
> ⚠️ **이 절의 규율 재확인 — 사라졌다고 해소된 것이 아니다.** 이월 6건 `B9`·`B20`·`B21`·`B48`·`B51`·`B63`은 **행을 그대로 유지**했고 이 파트가 하나도 건드리지 않았다(전건 잔존 확인). 특히 `B9`(access token 갱신 경로 부재)는 이 파트가 관측성·인증 문서를 만졌으므로 「같이 됐겠지」로 읽히기 쉬운데, 프론트 인터셉터는 손대지 않았다.

> **해소: 2026-08-22 (task#330) — B5·B7·B8·B42·B68·B69·B70·B71·B77 닫힘 (9건).** 10차 확정분 수정 5/7(**시간대 3 · 폴백·검증 2 · 동시성 3 · 트랜잭션 1**). **번호는 재사용하지 않는다** — 위 표에서 행만 제거했다.
>
> **시간대 3건** — 정본은 `services/utils.py::today_kst`(달력일)이고, 이번에 **타임스탬프용 `now_kst`를 형제로 신설**했다(구루 명부 `last_updated`가 UTC라 관리자 화면에 9시간 뒤처져 표시되던 것을 적대 검토가 잡았다 — 수동 `routers/guru.py`·자동 `scheduler/jobs.py` **두 레인 쌍**). 회귀 축은 **한 순간(instant)을 고정하고 그것을 어느 시간대로 읽는지만** 보는 하니스다(`tests/test_kst_date_boundaries.py::_freeze`) — 기존 `test_disclosures.py`·`test_insider_trades.py`의 「프로덕션과 같은 식으로 기대값을 재계산하는」 축은 시간대 결함을 **원리적으로 탐지할 수 없었다**. ⚠️ `test_no_bare_today.py`는 `.today()`만 보므로 `now()`/`utcnow()`는 **ast 감사 축**(`test_owned_modules_have_no_naive_now_or_utcnow`)이 담당하는데, 그 감사는 **열거된 파일만** 훑는다 → 새 타임스탬프 writer를 만들면 그 목록에 추가할 것(현재 6파일). 선재 잔존 4곳(`routers/analyst_reports.py`·`services/kis/futures.py`·`services/report_generator.py`·`market_indicators/kospi_signal.py`)은 `_KST` 자체 재구현 상태이며 이 파트 범위 밖이다. ⚠️ **「시간대 3건」이 전부 KST라고 읽지 말 것 — B8만 기준 시간대가 다르다.** B7(배당 기준연도)·B42(공시 조회 창)는 **KST 달력일**이 정답이라 `today_kst`로 접었지만, **B8은 US 애널리스트 액션의 `report_date`**이고 정답은 **시장 시간대(`America/New_York`)**다 — yfinance가 주는 epoch를 naive UTC로 읽으면 미 동부 20:00 이후 액션이 하루 앞선 날짜로 박제된다(라이브 실측: MSFT 929행 중 **7행** 어긋남). 그래서 `consensus_pipeline.py`는 `_US_MARKET_TZ` 상수를 따로 두고 `tz_localize("UTC")` → `tz_convert(_US_MARKET_TZ).date`로 환산한다. **이 자리를 `today_kst`류로 「통일」하면 B8이 되살아난다** — 「어느 달력일이냐」의 정답은 그 값이 속한 **시장**이 정하며 KST는 KR 시장·서버 배치 판정에만 정본이다(같은 함수의 수집 창 하한 cutoff는 계속 KST 기준이다 — 창의 하한이라 시장일과 최대 1일 어긋나도 「최근 N일」 의도를 해치지 않는다).
>
> **B70/B71(폴백·검증)** — 되짚기를 유계 루프(`_MAX_FETCH_ATTEMPTS=10`)로 바꾸되 **무계 루프는 금지**했다. 적대 검토가 그 유계 루프의 대가를 잡았다: 24개 업종이 **같은 휴일을 각각 되짚어** 기동 경로(`scheduler.start` → `_seed_kr_sector_if_empty` → `compute_momentum`, **동기**)의 키움 콜이 최대 240콜 = throttle만 60초가 됐다 → `fetch_sector_closes(empty_dts=…)`로 **refresh 1회 안에서만 공유되는 휴장 메모**를 도입(장기 휴장 144 → 27콜, 전 구간 장애 240 → 10콜). B71은 **판정 게이트를 `validate_schedule_spec`이 아니라 `_build_trigger`(빌드+CronTrigger 생성)로** 확정했다 — validator는 *새 입력*용이라 더 엄격해서, 그것을 기동 게이트로 쓰면 **변경 전에는 정상 등록·실행되던** 스펙 4형태(`time:'7:00'` · `enabled:1` · `day_of_month:'15'` · `every_minutes:3`)가 조용히 미등록되고 그 배치가 **영구히 안 돈다**(`GET /api/batches`의 `enabled=true`+`next_run=null`은 disabled와 구별되지 않아 며칠 stale해질 때까지 무음). validator 실패는 **경고로만** 남긴다. 시드 폴백은 `enabled`를 **승계**한다 — 레지스트리 기본값이 전부 `enabled: True`라 통째 교체하면 사용자가 옛 UI에서 꺼 둔 배치 4종이 조용히 켜진다.
>
> ⚠️ **B71에서 배운 것 — 잡 단위 가드는 기동 완주를 보장하지 않는다.** `scheduler.start()`는 `_reschedule_job` 루프 **뒤에** `_check_missed_report()`를 호출하고 `_scheduler.start()`는 그 다음이다. `_check_missed_report_for`가 **같은 저장 스펙을 독립적으로 다시 읽어** `int(cfg['time'].split(':')[0])`을 하므로, 깨진 `daily_report_kr`/`_us` 행은 잡 가드를 통과해도 **앱을 죽였다**(실측 재현). 게다가 `days`에 오늘 요일이 없으면 조기 return으로 **우연히 통과**해 날짜 의존 결함이 된다 — 그래서 red-first 픽스처가 `leverage_fetch`(= 이 함수가 읽지 않는 배치)를 깨뜨렸던 원래 축은 32개 배치 중 2개에 **원리적으로 블라인드**했다. 처방은 ⓐ `_parse_hhmm` 판정 ⓑ 시장 단위 try/except(누락복구는 부가 기능, 기동은 필수) ⓒ 픽스처의 `days`에 7요일 전부. **또 하나** — B71ⓐ가 기동을 살리자 **그 상태에서 `GET /api/batches`가 확정 500**이 되는 경로가 처음 도달 가능해졌다(`describe_schedule`이 `spec["type"]`·`spec["day_of_month"]`를 직접 인덱싱 → 깨진 행 하나가 응답 전체를 죽이고 **그 행을 수리할 유일한 화면**이 빈다). `routers/batches.py::_describe` 폴백으로 닫았다. task#283 렌즈(「무거운 실패를 걷어내면 그것이 가리고 있던 파손이 드러난다」)의 이 저장소 4번째 사례다.
>
> **동시성 3건** — 락 규율은 **「dict 조작 구간만 감싸고 `loader()`는 락 밖」**이고, 그 대가로 loader 실행 중 들어온 `invalidate()`를 **세대 카운터**로 감지해 캐시를 건너뛴다(`TTLCache._gen` · 모듈 전역 `_snap_gen`). 만료 정리는 **in-place 삭제**다 — 옛 구현의 `self._store = {...}` **재바인딩**은 그 창의 `invalidate(key)`를 버려질 dict에 적용해 유실시켰다. 락 중첩 0이 데드락 불가 근거이므로 `cache.invalidate(ticker)`는 `_snap_lock`을 **놓은 뒤** 파생 캐시를 무효화한다. ⚠️ 적대 검토가 **`_snap_gen` 가드의 이빨이 전 스위트에서 0**임을 잡았다(`if True:`로 무력화해도 실패 0) — 쌍둥이 `TTLCache`엔 축이 있는데 이쪽엔 **아예 없었다**. 같은 규율을 두 곳에 넣으면 **축도 두 곳에** 둘 것.
>
> ⚠️ **B77의 처방이 「이중 클릭이 자기치유하던」 성질을 제거했다 — 그 대가를 두 곳에서 되받아야 했다.** ⓐ **백엔드**: `running=True`를 회수하는 경로가 `finish()` 하나뿐인데 starlette는 응답 body flush **뒤** background를 호출하므로, flush 중 클라이언트가 끊기면 `_run_generation`이 시작조차 않고 그 사용자가 **프로세스 재시작 전까지 영구 409**가 된다 → **무활동 15분 회수**(`ProgressTracker._STALE_AFTER`, 판정은 경과시간이 아니라 무활동 시간이라 오래 걸리는 정상 생성은 영향 없음. `ProgressRegistry._evict_locked`도 고착 트래커를 유휴로 본다 — 아니면 그 슬롯이 상한을 영구 잠식한다). ⓑ **프론트**: 두 진입점이 POST **전에** 폴러를 끊고 bare catch가 「리포트 생성 실패」만 띄워, 409에서 **거짓 진술 + 진행 중 생성의 폴링 소실**이 됐다(트래커 키가 user_id 하나라 「전체 생성 → 개별 재생성」이라는 흔한 admin 흐름에서 **상시** 발생한다) → `useReportGeneration.js::_handleConflict`가 warning 토스트 + **폴링 재개**를 하고 완료 문구는 거부된 종목명을 주장하지 않는다(`ReportManualGen.jsx::handleGenerate`도 같은 처리). 두 명세서에 409·`failed`·호출자 한정 서술도 함께 넣었다 — `test_api_doc_sync.py`는 엔드포인트 *존재*만 보므로 이 drift는 자동 게이트가 원리적으로 못 잡는다.
>
> **B5(트랜잭션)** — 정확한 규모는 「DELETE 6문장 / 독립 트랜잭션 7개」다(확인 `query` 1 + `execute` 6 — `db.execute`가 호출마다 커넥션을 얻어 커밋한다). `.forge/bug-report.md`가 「5개 테이블」로 적어 CONCERNS와 수치가 갈려 있었다. 한 커넥션의 단일 트랜잭션으로 접고, **가드 read를 같은 트랜잭션에 `FOR UPDATE`로** 넣었다 — 확인과 삭제가 다른 트랜잭션이면 그 틈의 admin 승격이 403 가드를 우회한다.
>
> ⚠️ **이 절의 규율 재확인 — 사라졌다고 해소된 것이 아니다.** 이월 6건 `B9`·`B20`·`B21`·`B48`·`B51`·`B63` + `B6`(부분)은 **행을 그대로 유지**했고 이 파트가 하나도 건드리지 않았다(전건 잔존 확인). 특히 `B69`가 `services/cache.py`를 통째로 만졌으므로 `B63`(프론트 포매터 중복)·`B48`(에러 바운더리 부재)이 「캐시·렌더를 정리하며 같이 됐겠지」로 읽히기 쉬운데, 프론트는 `useReportGeneration.js`·`ReportManualGen.jsx` 두 파일의 409 처리만 손댔다.

> **해소: 2026-08-22 (task#331) — B24·B34·B54·B55·B56·B57·B58·B76 닫힘 (8건) + B49 부분.** 10차 확정분 수정 6/7(**시각 2 · 상태 3 · 계약·표시 4**). **번호는 재사용하지 않는다** — 위 표에서 행만 제거했다. 회귀축은 신설 프론트 테스트 **7파일**(`frontend/src/test/tech-visual-guards` · `failure-vs-empty` · `stale-response-guard` · `report-detail-stale` · `ranking-news-failure` · `tracked-mutex-and-format` · `diaglog-copy-failure`) + `backend/tests/test_valid_events_matches_frontend.py`이고, 레이아웃 수치는 jsdom이 원리적으로 못 재므로 `scripts/uat331-tech-visual.mjs`가 라이브 축을 맡는다.
>
> **시각 2건** — **B54**는 자르지 않고 **흐르게** 했다(`wordBreak: keep-all` + `overflowWrap: break-word`; 라이브 실측 15장 중 pc1440 10 · m390 8 · m350 9장이 잘려 있었고 최악은 2219px 중 258px = 11.6%만 보였다). **B55**는 값 칸에 `width: <최장 값 문자열>ch` + `flexShrink: 0`을 예약했다 — ⚠️ **폭은 그룹별이 아니라 전체 행 기준으로** 잡는다(그룹마다 다르게 잡으면 그룹 간 트랙 폭이 갈려 분류를 넘나드는 막대 비교가 다시 무의미해진다). 라이브 실측에서 단조성 위반은 아직 0이었는데 그건 값 문자열 길이가 다른 두 행의 값이 우연히 가깝지 않아서일 뿐이고, 형제 `MarketEstimates.jsx`는 같은 원인으로 이미 역전($12.5B 75.98px < $9B 84.86px)을 냈다 — **「지금은 안 보인다」를 「없다」로 읽지 말 것.**
>
> ⚠️ **B54의 안전망을 `anywhere`로 쓰지 말 것 — 그리고 형제에는 그 반대가 참이다.** 이 자리에서 `break-word`와 `anywhere`는 결과가 **완전히 동일**한데(그리드 트랙 최소가 240px **고정값**이라 min-content가 쓰이지 않는다) `anywhere`는 Safari/iOS **15.4+** 전용이라 그 미만에서는 선언만 드롭돼 `keep-all` 단독(= 페이지 가로 스크롤)으로 떨어진다. 이 앱은 iOS 설치형 PWA이고 **Chromium 프로브는 이 차이에 원리적으로 블라인드**하다(`inset` footgun과 같은 클래스). 반대로 형제 `components/tech/PlayerTable.jsx`는 `anywhere`가 **필요하다**(스크롤러가 없어 min-content가 실제로 트랙 폭을 결정한다) — 이 근거로 그쪽 값을 바꾸지 말 것.
>
> ⚠️ **B54가 시각 부산물을 하나 만들었고, 기존 프로브 축은 그것을 원리적으로 못 잡았다.** 제목 전문 노출의 대가로 stretch 그리드에서 한 행이 가장 긴 제목에 맞춰 커지는데 footer(구분선 + 해부 칩)는 in-flow 자연 위치에 머물러 **구분선이 카드 중간에 뜨고 그 아래가 최대 ~310px 빈다**(pc1440 실측 `card.bottom − footer.bottom` **309.5px** = 카드의 60%; 1열 모바일은 무영향). 카드를 column flex로 두고 footer에 `marginTop: auto`로 닫았다. 기존 축 `grid-row-heights-equal`은 「행 높이가 **같다**」를 *요구*하므로 이 결함이 성립하는 조건과 무모순이다 → `card-footer-at-bottom` 축을 신설했다.
>
> **상태 3건** — **B76**은 `watchTickers`를 3상태(`null`=모름 · `[]`=성공 0건 · 배열)로 두고 `computeTechCandidates`가 모름이면 후보를 **하나도 내지 않게** 했다(실패를 `[]`로 붕괴시키면 「내가 안 가진 후보」라는 *행동 권유*가 거짓 근거로 나온다). 같은 클래스의 형제 2건을 함께 닫았다 — `Ranking::BasicInfo` 뉴스 조회 실패(→ 「관련 뉴스가 없습니다」 거짓 단정) · `ConsensusChart` 미조회(→ 「아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요」 = 거짓 **행동 지시**). **B58**은 `pending` Set으로 그 티커의 *모든* 배지를 함께 잠그고 `aria-busy`/`cursor`로 알린다(뮤텍스는 레이스 가드가 아니고, 호출부가 반환값을 버려 무음 삼킴을 감지조차 못 했다).
>
> ⚠️ **B76의 초기값 `null` 자체가 한동안 무커버리지였다 — 실패 축만 있고 「아직 안 옴」 창은 안 재고 있었다.** 그쪽이 3요청 병렬이라 **매 마운트** 발생하는 더 흔한 발현면인데도 그랬다 → `failure-vs-empty.test.jsx`에 in-flight 축을 추가했다. 「3상태」를 도입하면 **세 상태 전부**에 축을 두어야 한다(실패만 재면 미조회가 사각으로 남는다).
>
> ⚠️ **B58의 수정이 같은 사이클에 회귀 1건을 만들었다 — React는 `undefined`를 「미지정」으로 취급하지 않는다.** `opacity: busy ? 0.6 : undefined`가 `badgeStyle`의 `opacity: 0.5`(모름 분기)를 **키 존재만으로** 덮어써 모름 배지의 흐림이 사라졌다(스프레드에서 `undefined` 값도 키를 덮는다). 조건부 스프레드로 고쳤고 `tracked-unknown-affordance.test.jsx`에 실측 축을 쌍으로 뒀다.
>
> ⚠️ **B49는 닫지 않았다 — 주 인스턴스 + 형제 4곳만 닫고 행을 *축소해* 남겼다.** `pages/Reports.jsx` 상세 fetch(취소 플래그 3핸들러 + `.catch` → 실패는 실패 배너로 표시해 옛 티커 수치를 유지하지 않는다) 외에 `AnalystReport.jsx` 발행물·이력 이펙트(`ReportDetailTabs`가 `key` 없이 렌더해 **같은 마운트 내** 레이스였다) · `HistoryTab` 3이펙트 · `ConsensusChart::fetchData` · `DetailTab::BacklogSection`을 함께 닫았다. **남은 미가드 6곳은 `§7.3` 표**(`Ranking::onRowClick` · `Calendar` 월 이펙트 · `Recommendations::handleChip` · `StockSearchBox` · `usePortfolioData` · `useReportList`)다.
>
> ⚠️ **세대 가드에서 배운 것 두 가지.** ⓐ **가드는 「늦은 착지」만 막고 「보존」은 막지 않는다** — 옛 데이터가 *이미* 착지한 뒤 식별자(prop)만 갈리면 경합 없이 결정적으로 옛 데이터가 새 화면을 소유한다. 그래서 식별자 변경 시 **상태를 `null`(미조회)로 되돌리는** 것이 쌍으로 필요하다(`[]`로 되돌리면 「0건」이라는 거짓 진술이 된다). ⓑ **`.finally` 게이트의 회귀 축은 새 요청을 in-flight로 붙잡은 채 낡은 응답을 착지시켜야 이빨이 생긴다** — 새 요청을 먼저 해소하는 픽스처는 두 `.finally`가 같은 값을 써서 관측 차이가 **원리적으로** 생기지 않는다(주입 실측: 그 순서에서는 `.finally` 게이트를 지워도 8축 전부 초록이었다).
>
> **계약·표시 4건** — **B24**는 `VALID_EVENTS`에 `nav_analytics`를 추가하고 `backend/tests/test_valid_events_matches_frontend.py`로 **3방향**을 대조한다(프론트 수확 ⊆ 화이트리스트 / 화이트리스트 잔여 == `RETIRED_EVENTS` 베이스라인 / `AdminAnalytics.jsx::EVENT_LABELS` ⊇ 화이트리스트 — 라벨이 없으면 원시 영문 키가 렌더되는데 graceful이라 어떤 게이트도 안 알린다). **B34**는 `fmtSharesUs`가 **절대값으로 티어를 비교하고 부호를 축약 뒤에 붙인다**(⚠️ 소비처 `UsInsiderSection.jsx`가 양수에 '+'를 직접 붙이므로 여기서 넣는 부호는 `'-'`뿐이다 — '+'까지 넣으면 `++1.20B`가 된다). **B57**은 페이지 게이트를 컴포넌트의 채택 조건과 **등가**로 맞췄다(`related[k].length > 0` → `related[k].some(nonBlank)`; `TechGraph::validLabels`가 모듈 private이라 호출할 수 없어 산문 게이트가 이미 쓰는 `nonBlank`로 등가식을 재현하고, 드리프트는 `TechReport.test.jsx`의 양방향 등가 표가 맡는다). ⚠️ **백엔드 `routers/tech_reports.py::Related`는 무변경이다** — `List[str] = []`에 항목별 non-empty 제약을 넣지 않았으므로 공백 원소는 여전히 201로 통과하고, 화면이 그것을 「없음」으로 취급한다(`wrong < missing` 방향). 즉 **요청·응답 계약이 바뀌지 않았으므로** `API_SPEC.md`·`CLAUDE_COWORK_API.md`의 `related` 필드 서술은 갱신 대상이 아니다(둘 다 필드 형태만 적고 렌더 조건을 약속하지 않는다 — 실측 확인). **B56**은 `legacyCopy`가 `execCommand` 반환값을 확인해 throw하고 화면 상태를 3값(`idle`/`copied`/`failed`)으로 두었다 — 실패 안내가 「아래 로그를 직접 선택해」이므로 「지우기」가 그 상태를 **리셋**한다(가리킬 대상이 없어지면 안내가 거짓이 된다).
>
> ⚠️ **B24의 수확기 정규식을 좁히지 말 것.** 인용부호는 단·쌍·백틱을 모두 받는다 — 좁히면 「새 이벤트를 쌍따옴표로 정의하고 화이트리스트 등록을 잊은 경우」에만 무음이 되어 **정확히 B24가 재발하는 방향에서만** 감사가 공허해진다. 수확 0건을 통과로 세지 않도록 `assert literals`·`assert evt_fields`·`assert prefixes and perms` sentinel을 쌍으로 뒀다.
>
> ⚠️ **이 절의 표기 규율 — 닫힌 행은 `~~Bnn~~`로 남기지 말고 제거할 것.** 이 파트가 처음에 취소선 형태로 8행을 남겼는데, 규정된 §0 행 수 감사(`grep -cE '^\| *\**B[0-9]'`)가 **`~~`로 시작하는 행을 원리적으로 못 센다** — 20행이 남아 있는데 감사가 **12**를 반환해 「행을 이미 제거했다」와 **글자 하나 다르지 않게** 보였다(우연히 목표값과 일치했다). 「감사 패턴을 좁히면 그 감사는 통과해도 무의미하다」의 이 절 자신에 대한 적용이다 — 표기를 바꾸려면 **감사 패턴을 먼저** 바꿔야 한다.
>
> ⚠️ **이 절의 규율 재확인 — 사라졌다고 해소된 것이 아니다.** 이월 6건 `B9`·`B20`·`B21`·`B48`·`B51`·`B63` + `B6`(부분) + `B80`은 **행을 그대로 유지**했고 이 파트가 하나도 건드리지 않았다(전건 잔존 확인 — 잔존 12행). 특히 `B48`(에러 바운더리 부재)·`B63`(포매터 중복)은 이 파트가 프론트 표시 9건을 훑고 `frontend/src/utils.js`의 포매터를 직접 만졌으므로 「같이 정리됐겠지」로 읽히기 쉬운데, **둘 다 task#333의 비목표로 명시**돼 손대지 않았다(`B34` 한 함수만 고쳤다). `B51`(`?diag=1` 인가코드 기록)도 이 파트가 같은 파일 `components/DiagLog.jsx`를 만졌으므로 같은 오독 위험이 있는데, 고친 것은 복사 폴백뿐이고 진단 로그의 인가코드 기록 경로는 그대로다.

### 데이터 손실·오염

| # | 결함 | 위치 (심볼) | 도달 조건 |
|---|---|---|---|

### 무음 미동작 / 오값

| # | 결함 | 위치 (심볼) | 도달 조건 |
|---|---|---|---|
| B6 | 키 미설정 배치가 "성공"으로 기록 · **부분(도달조건 축소, 재판정 task#329)**: 원 서술이 지목한 3위치 중 **2곳이 닫혔다** — `econ.py::_fetch_and_save_econ_indicators`는 계열별 소스-폴백 + `_status`(partial/skipped)를 반환하고, `scheduler/jobs.py::_refresh_monthly_us`는 `as run`으로 그것을 받아 `set_status`한다(수동 2레인 `refresh-econ`·`refresh-monthly?market=US`도 함께). **남은 도달 경로는 `macro.py` 하나뿐이다** — `_fetch_and_save_macro_signals`가 키 미설정 시 예외 없이 `{"error": …}`를 반환하는데 `_status`가 없고, 두 레인(`scheduler/jobs.py::_refresh_macro_signals` · `routers/market_indicators.py::refresh_macro_signals`) **모두 `as run` 미배선**이라 반환값을 아무도 검사하지 않는다. 형제 `econ.py`가 참조 구현이다(§6.1) | `market_indicators/macro.py::_fetch_and_save_macro_signals` → `scheduler/jobs.py::_refresh_macro_signals` · `routers/market_indicators.py::refresh_macro_signals` | `FRED_API_KEY` 미설정 |
| B9 | 프론트에 access token 갱신 경로가 없다 — 백엔드 `/api/auth/refresh`는 **존재하는데** 아무도 안 부른다 | `frontend/src/api.js` 응답 인터셉터 | 1시간 경과(항상) |
| B53 | 루틴 프롬프트의 `market_outlook` 예시가 **문자열 템플릿**이라 AI가 산문으로 채우면 `segments[]`가 `None`이 되어 「사업부문 시장 분석」 섹션이 **크래시 없이 조용히 사라진다**(정본 `CLAUDE_COWORK_API.md`는 객체로 못박고, `routers/stocks.py`엔 스키마 검증이 없어 422 피드백도 없다) | `scripts/cowork-routine-prompt.md` → `services/analyst_reports.py::_market_outlook_segments` | 루틴이 프롬프트 예시 형태를 따를 때 |

### 계약·보안

| # | 결함 | 위치 (심볼) | 도달 조건 |
|---|---|---|---|
| B20 | 레이트리밋 전무 — bcrypt 로그인이 곧 CPU 고갈 DoS | `routers/auth.py::login` | 무인증·무계정 |
| B80 | 경로 조각이 SQL `date` 캐스트로 직행해 **500**이 된다 — `GET /api/report/{ticker}/{date_str}`가 `date_str`을 검증하지 않아 `InvalidDatetimeFormat`이 미포착 예외로 올라간다. 400/404여야 하는 입력이 500이므로 ⓐ 외부 소비자가 「서버 장애」로 오독하고 ⓑ 오타 경로가 에러 로그를 오염시킨다. **선재 결함이며 task#330 라이브 스모크에서 발견**됐다 — task#326이 넣은 전역 예외 핸들러가 `[UnhandledError]` 마커로 로그를 남기기 시작해 **비로소 관측 가능해졌다**(그 전엔 로그 없는 raw 500) | `routers/report.py::get_report`(catch-all `/{ticker}/{date_str}`) | 무인증 불가(인증 필요) · 임의 경로 조각 1개 |
| B81 | `title` 필드에 **두 모집단이 섞여 있고 스키마에 상한이 없다** — 라이브 15종 실측이 「13~24자 이름」(7종: 「태양광 — 셀·모듈 기술」)과 「93~207자 리드 문장」(8종, 전부 2026-08-21 발행: 「중국 링룽 1호의 '2026년 상반기 상업운전' 시한은…」)으로 갈린다. `TechReportIn.title`에 `max_length`·`min_length`가 없어(빈 문자열도 201) **목록 카드 높이의 상한이 발행자 규율에만 의존**하는데 그 규율이 이미 깨졌다. 결과: m390 목록 페이지 높이 **14997px**, PC 카드 높이 275~455px. ⚠️ **B54의 잘림 제거는 옳다**(상세 페이지가 같은 필드에 「ellipsis·line-clamp 금지」를 명시하고 그 근거가 「한국어는 술어가 끝에 와 잘림이 결론부터 먹는다」다) — 잘림을 되살리는 것이 처방이 **아니고**, ⓐ 스키마 상한 ⓑ 발행 루틴이 `title`에 이름을 넣도록 정정 ⓒ 카드에 별도 요약 필드 사용 중 하나다. **task#331 육안 확인에서 발견**(프로브는 「잘리지 않음」을 재므로 통과했다 — 육안이 유일한 포착 수단이었던 7번째 사례) | `routers/tech_reports.py::TechReportIn.title` · `pages/TechReports.jsx` 카드 · 발행 루틴 `scripts/cowork-routine-prompt.md` | 발행자가 `title`에 리드 문장을 넣으면(현재 8/15) |
| B21 | Postgres가 tracked 폴백 비밀번호로 호스트 5432에 발행 | `docker-compose.yml` (`POSTGRES_PASSWORD`) | 호스트 접근 가능한 누구나 |
| **B51** | `?diag=1`이 인증 분기보다 **앞서 렌더**되고, 진단 로그가 OAuth 인가코드를 **소비 전 원문으로** `localStorage['diag_log']`에 영구 기록한다 — `logDiag('doc', {url: pathname+search})`가 이펙트 최상단이라 `replaceState` 스트립·코드교환 `fetch`보다 먼저 캡처한다. ⚠️ 같은 파일에서 같은 형태(URL 크리덴셜→localStorage)를 **이미 세션 고정 취약점으로 판정해 제거한 전례**가 있다(B44/task#290, `ARCHITECTURE.md`) — 반복 맹점 | `App.jsx::App`(diag 분기) · `hooks/useAuthBootstrap.js`(최상단 `logDiag`) · `utils/diag.js::logDiag` · `components/DiagLog.jsx` | 코드 미소비(네트워크 실패) ∧ 같은 브라우저 접근 제3자 ∧ TTL 120초 내 |
| **B75** | `variants` 신규 검증 **3종이 `API_SPEC.md`·`CLAUDE_COWORK_API.md`의 422 목록·필드표 어디에도 없다** — 스키마는 올바르게 강제 중이고 테스트도 있으나(`test_tech_reports_router.py`·:598), **외부 Cowork 클라이언트가 그 422의 사유를 문서에서 알 수 없다**. `test_api_doc_sync.py`는 엔드포인트 *존재*만 보므로 원리적으로 못 잡는다 | `routers/tech_reports.py::VariantOption._has_comparison_content` · `::VariantAxis._option_names_unique` · `::TechReportIn._variant_axis_labels_unique` → 두 명세서 | Cowork가 중복 축 라벨·중복 옵션명·이점/대가 전무로 발행 시도 |

### 표시 오류 / 크래시

| # | 결함 | 위치 (심볼) |
|---|---|---|
| **B48** | **에러 바운더리가 트리 어디에도 없다** — 렌더 throw 1건이 전체 백지 | `frontend/src/` 전역 (grep 결과 0건) |
| **B49** | **부분(주 인스턴스 닫힘, task#331)** — `pages/Reports.jsx` 상세 fetch에 취소 플래그 + `.catch`를 넣었고(실패는 실패 배너로 표시해 옛 티커 수치를 유지하지 않는다), 형제 4곳도 함께 닫았다: `AnalystReport.jsx` 발행물·이력 이펙트(`ReportDetailTabs`가 `key` 없이 렌더해 **같은 마운트 내** 레이스였다) · `HistoryTab` 3이펙트(`.finally`까지 게이트) · `ConsensusChart::fetchData`(세대 가드 + 티커 전환 시 `null` 리셋) · `DetailTab::BacklogSection`. ⚠️ 세대 가드는 「늦은 착지」만 막고 「보존」은 막지 않는다 — 옛 데이터가 *이미* 착지한 뒤 prop만 갈리면 경합 없이 결정적으로 옛 데이터가 새 화면을 소유하므로, 식별자 변경 시 **상태를 `null`(미조회)로 되돌리는** 것이 쌍으로 필요하다(`[]`로 되돌리면 「0건」이라는 거짓 진술이 된다). **남은 미가드는 §7.3 표** — `Ranking::onRowClick` · `Calendar` 월 이펙트 · `Recommendations::handleChip` · `StockSearchBox` · `usePortfolioData` · `useReportList` 6곳 | `frontend/src/pages/Reports.jsx` 상세 fetch 이펙트(닫힘) · §7.3 표의 6곳(열림) |
| B63 | 프론트 포매터 중복 — 재계수 완료(§13.2에서 열림 확정, task#292) | `frontend/src/utils.js` 및 산발 포매터 (§7.7·§7.9) |

### 검증장치·문서

| # | 결함 | 위치 (심볼) |
|---|---|---|
| B59 | fg-map 산출물의 카운트 3곳이 실측과 어긋난다 — **원인이 두 클래스다**: ⓐ `pages/ (24 jsx)`는 `last_mapped_commit`과 무관한 **작성 시점 오기**(문서 자신의 하위 나열 합 33과도 모순 → 매핑 시 셀프체크로 잡을 수 있었다. 재실행으로는 재발을 막지 못한다) ⓑ ADR `0001~0035`(실제 0037)·프론트 테스트 63(실제 64)은 **진짜 post-mapping drift**(task#290·#291이 CONCERNS만 수동 패치하고 이 두 문서는 빠뜨렸다) | `.forge/codebase/STRUCTURE.md` §3 `pages/` · §5 `adr/` · `.forge/codebase/TESTING.md` §1·§2 |

---

## 1. 데이터 무결성 — 빈/실패 fetch가 양호값을 덮어씀

이 저장소에서 가장 잘 이해된 결함 가족이고, **정답 형태가 코드 안에 이미 존재한다**(§1.7). 남은 위험은 그 형태를 안 쓴 자리들이다.

### 1.1 `get_kr_rankings` wipe-on-empty — **해소(task#329)** (B1)

> ✅ **해소.** 아래는 옛 상태 기록이다. 현재 `_fetch_naver_market`은 **① 1페이지 빈 `stocks`**(200 + `totalCount:0`) **② 뒷 페이지 future 실패** **③ 커버리지 `_MIN_PAGE_COVERAGE = 0.5` 미달** 셋을 각각 `RuntimeError`로 던져 호출측(스케줄러 2잡·수동 라우터·발굴 유니버스)이 `replace`를 통째로 건너뛰게 한다. delete-rewrite 경로에는 담아둘 last-good이 없으므로 **예외 전파가 소스-폴백의 대응물**이다. genuine-empty를 clear하지 않는 이유도 docstring에 있다 — 전 종목 목록이 *진짜로* 0건인 시장 상태는 없어 무데이터와 장애를 구별할 수 없고, 비용이 비대칭이다(잘못 보존 = 다음 크론까지 stale / 잘못 삭제 = 랭킹 탭 + `investor_trend_fetch` 유니버스 동시 소멸). 형제 `get_us_rankings`와의 비대칭도 사라졌다.

`services/ranking_service.py::_fetch_naver_market`의 (옛) docstring은 *"한 페이지라도 실패하면 RuntimeError를 던진다 — 잘린 데이터가 정상 스냅샷을 DELETE-덮어쓰는 것을 막기 위함"* 이라고 의도를 명시하지만, **0페이지 케이스에 구멍이 있다**:

```python
total = int(body.get("totalCount", 0))
stocks = list(body.get("stocks", []))
pages = math.ceil(total / _PAGE_SIZE)
if pages <= 1:
    return stocks          # totalCount==0 → pages==0 → 예외 없이 [] 반환
```

형제 경로 `get_us_rankings`는 같은 자리에 가드가 있다 — `raise RuntimeError("ranking: US fetch returned empty quotes — skipping replace")`. **비대칭이 결함이다.**

도달: Naver `marketvalue`가 200 + `totalCount:0`(스키마 변경·소프트 레이트리밋)을 KOSPI·KOSDAQ 양쪽에 반환 → `replace_market_rankings("KR", …)`가 `DELETE FROM market_rankings WHERE market='KR'` 후 0행 삽입, 트랜잭션은 정상 커밋. 파장은 랭킹 탭 공백에 그치지 않는다 — `investor_trend_fetch`의 유니버스 쿼리가 `market_rankings`를 읽으므로 **수급 배치의 대상 집합까지 함께 사라진다**. 복구는 프로세스 재기동 시 `_seed_rankings_if_empty`뿐.

### 1.2 `_mc_load` 실패가 "저장값 없음"과 구별되지 않는다 — **해소(task#329)** (B40)

> ✅ **해소.** 아래는 옛 상태 기록이다. `cache.py::_mc_load_strict`(조회 실패를 *전파*, 행 부재만 `None`)가 신설되고 `refresh_kospi_signal`이 그것으로 전환됐다 — 예외가 전파되면 `_mc_save`에 도달하지 못해 누적 `series`·적중률이 보존되고, `scheduler/jobs.py::_refresh_kospi_signal`이 `as run`으로 받아 `failed`를 기록한다(이 한 건에서는 예외 전파가 `set_status`보다 정확한 신호다). `_mc_load` 자체는 **additive로 보존**됐다(앱 36곳·18모듈 + patch하는 테스트 17파일의 반환 계약 불변). 이 모호성의 **일반형**(가드의 baseline이 붕괴해 가드가 스스로 꺼지는 문제)은 §1.8에 별도로 정리했다. 아래 "같은 클래스" 목록 중 `econ.py`도 함께 닫혔고 `macro.py`·`kr_sector_service`는 열려 있다.

`market_indicators/cache.py::_mc_load`는 (관용 경로에서) 예외를 경고 로그 후 `None`으로 삼킨다:

```python
except Exception as e:
    logger.warning(f"[Cache] _mc_load key={key} 실패: {e}")
return None            # DB 오류와 "한 번도 저장 안 됨"이 같은 값
```

이 모호성이 실제 데이터 손실이 되는 자리가 `market_indicators/kospi_signal.py::refresh_kospi_signal`이다:

```python
stored = _mc_load("kospi_signal")
stored_data = (stored["data"] if stored else None) or {}
series: list[dict] = list(stored_data.get("series", []))     # DB 오류 → []
...
if changed:
    _mc_save("kospi_signal", data)                            # 누적 이력을 1건으로 덮어씀
```

도달: 07:30 `kospi_signal_fetch` 중 그 `SELECT` 한 번이 실패(§4.5의 `PoolError` 포함)하면서 yfinance 드라이버는 성공(`fetch_ok=True` ⇒ `changed=True`) → `_MAX_DAYS` 누적 신호·적중률 이력이 소멸한다. **재구성 불가**(같은 날 갭·종가 대사로 파생되는 값이다). `job_runs`는 success로 기록한다.

같은 클래스·낮은 폭발반경: `macro.py`·`econ.py`는 `today_kst().year - 3`부터 시계열을 다시 시작하고, `kr_sector_service.refresh`는 부분 백필을 조용히 건너뛴다.

### 1.3 부분 페이로드가 완전한 값을 대체 — **잠재 위험**

전 `_mc_save` 호출자(17개)를 실패 클래스 3종 — (a) 예외 (b) 성공-but-빈응답 (c) 부분 페이로드 — 으로 감사한 결과, **(c)를 안 막는 곳이 3개** 남아 있다(2026-08-22 재판정: 옛 판의 4개 중 `us_sector`·`econ` 2개가 닫혔고 새로 생긴 곳은 없다).

| 심볼 | (a) | (b) | (c) |
|---|---|---|---|
| ~~`us_sector_service.py::refresh`~~ | ✅ | ✅ | ✅ **B43 해소** |
| ~~`market_indicators/econ.py::_fetch_and_save_econ_indicators`~~ | ✅ | ✅ | ✅ **해소** |
| `market_indicators/macro.py::_fetch_and_save_macro_signals` | ✅ | ❌ | ❌ |
| `market_indicators/sentiment.py::get_fear_greed` | ✅ | ✅ | ❌ |
| `market_indicators/exports.py::_fetch_customs_exports` | ✅ | ✅(월 목록) | ❌(월별 0 드롭) |

- ~~**B43 `us_sector_service::refresh`**~~ — **해소(task#329).** 옛 판: all-None만 막고 부분은 안 막아, 11개 `SECTOR_ETFS` 중 10개가 실패하면 "좋은 1개 + all-None 10개"가 직전 양호값을 덮고 다음 07:20 배치까지 서빙됐다. 이제 형제 `kr_sector_service::refresh`처럼 **실패 ETF만 직전 저장값으로 개별 백필**한다(매칭 키는 KR의 `code`가 아니라 **`etf`**). ETF 11종은 서로 합산되지 않는 **독립 항목**이라 커버리지 임계가 아니라 개별 백필이 맞는 처방이다. 전량실패 판정은 백필 *앞*이고 baseline은 엄격 로더 `_load_momentum_strict`다(관용 `load_momentum`은 조회 실패를 `[]`로 접어 백필 0건 → all-None 저장이라는 fail-open destructive를 만든다). KR의 `index` 같은 동반 필드는 없음이 확인됐다(저장 payload가 `sectors` 단일 필드). 회귀는 `tests/test_us_sector_partial_backfill.py` 신설.
- ~~**`econ`**~~ — **해소(task#329).** 계열별(`cpi`·`unemployment`) 독립 try + `if not new_pts: raise ValueError`로 (b)를, 계열 단위 직전값 폴백으로 (c)를 막는다. 누적 baseline은 `_mc_load_strict`(§1.8). 부수로 `get_econ_indicators`의 `_mc_delete`가 **오염 판정 시에만** 돌게 좁혀졌다 — 옛 코드는 `_mc_load`가 조회 실패로 `None`을 준 경우에도 삭제해, `default_start`가 항상 「올해−3년」이므로 그 이전 구간이 **영구 소실**될 수 있었다. `_is_valid_econ_data`가 빈 배열을 유효로 판정하는 성질(`unemp[-1] > 50`만 거부)은 그대로지만, 이제 빈 배열이 저장까지 도달하지 않는다.
- **`macro`** — 예외 경로는 `return stored_data`로 막혀 있으나 FRED가 200 + `observations: []`를 주면 통과한다. **형제 `econ`이 같은 wave에서 고쳐졌으므로 그 파일이 그대로 참조 구현이다**(계열별 독립 try + 빈응답 raise + `_status` + `_mc_load_strict`). 관측성도 함께 열려 있다 — 두 레인 모두 `as run` 미배선(§6.1, B6 잔존 절반).
- **`sentiment::get_fear_greed`** — `score`만 파싱되면 dict를 반환하므로 `fear_and_greed_historical`이 빠진 응답에서 `history: []`가 저장돼 60일 이력을 덮는다.
- **`exports`** — `all_months = sorted(m for m in months if total_by_month.get(m, 0) > 0)`가 총계 0인 달을 드롭한다. 호출부 가드는 `if not data.get("months")`뿐이라 12개월 중 2개월만 살아남아도 통과한다.

### 1.4 delete-rewrite 인벤토리 — **대부분 이미 가드됨**

delete-then-insert 5곳은 전부 **단일 `get_connection()` 트랜잭션**이라 원자적이다(§4.3의 롤백이 창을 덮는다): `dividends.py::replace_schedule`, `recommendation/store.py::replace_recommendations`, `ranking_service.py::replace_market_rankings`, `consensus_pipeline.py::backfill`(`force=True` 분기), `storage/portfolio.py::save_watchlist_tickers`.

`replace_market_rankings`의 트랜잭션 자체는 정상이다 — **입력이 버그다**(§1.1).

> ⚠️ **지시문·직전 판이 delete-rewrite로 지목한 4개 서비스는 실제로 append-only다.** `short_sell_service.py::upsert_trend`·`investor_service.py::upsert_trend`·`lending_service.py::_upsert`·`leverage_service.py::_upsert_rows`에 `DELETE`는 없고, `db.execute_many`가 빈 리스트에 no-op이라 **빈 fetch가 이미 안전하다**. 이 오귀속을 근거로 가드를 추가하지 말 것.

### 1.5 `_mc_save` 자체엔 가드가 없다 — **설계상 트레이드오프**

`market_indicators/cache.py::_mc_save`는 무조건 `INSERT … ON CONFLICT DO UPDATE`다. 모든 판단이 호출자에 산다. 이 배치가 §1.3의 비대칭을 구조적으로 허용한다 — 새 저장 지점을 추가하는 사람은 3종 실패 클래스를 스스로 다시 발명해야 한다.

### 1.6 소스-폴백이 정답 형태다 — **이미 가드됨(참조 패턴)**

가드가 **저장 직전 한 지점**이 아니라 **fetch 계층**에 있는 구현은 구조적으로 안전하다. 신규 증분 저장을 짤 때 베낄 대상:

- `market_indicators/fx.py::_fetch_fx` — 실패 시 `stored_history`를 담아 *반환*한다(빈 값이 필드에 도달하지 않는다).
- `market_indicators/cache.py::_merge_history` — `_merge_history(prev, [])`가 `prev`를 그대로 돌려준다.
- `services/dividends.py` — `fetch_dividend_schedule(...)`를 `replace_schedule` **진입 전에** 평가한다.
- `market_indicators/exports.py` — KITA → UN Comtrade → last-good + `stale: True` 마커의 3단 폴백. **이 저장소에서 가장 완성된 형태이고, 나머지 12개 소스가 베껴야 할 템플릿이다.**
- `storage/schedule.py::save_guru_managers` — per-manager 백필 + `_ROSTER_MIN_COVERAGE` 커버리지 임계.
- `market_indicators/earnings.py::_fetch_and_save_m7_earnings` — 고정 명명 집합엔 완전성(`m7_ok < len(M7)`), 유동 대규모 집합엔 커버리지 임계(`_REST_MIN_COVERAGE`).

**2026-08 추가(task#329) — 세 처방이 각자 자기 집합 성격에 맞게 이식됐다:**

- `services/recommendation/funnel.py::run_recommendation_batch` — **유동 대규모 집합 → 커버리지 임계** `MIN_SCORED_COVERAGE = 0.5`. 분모가 `len(candidates)`인 것이 핵심이다(`len(universe)`로 잡으면 Stage-1 top-K 절단만으로 정상 실행이 상시 임계 미달이 된다). 경계는 `<`라 정확히 0.5면 저장한다.
- `services/us_sector_service.py::refresh` — **독립 항목 → 실패분만 개별 백필**(ETF 11종은 서로 합산되지 않는다). 전량실패 판정이 백필 *앞*이고, 백필 baseline은 `_load_momentum_strict`(엄격)다.
- `market_indicators/earnings.py::_tickers_with_cache` — **축소 하한** `_TICKER_MIN_RETAIN = 0.9`. 기준을 정적 시드가 아니라 **직전 저장값**으로 잡은 근거가 주석에 3항으로 적혀 있다(시드 기준은 자기교착을 만든다 — 실측 `kospi_tickers.json` 2182건 vs 라이브 KOSPI-only 스크레이프 규모).
- `services/ranking_service.py::_fetch_naver_market` — **delete-rewrite 경로의 소스-폴백 대응물**: 담아둘 last-good이 없으므로 실패를 **예외로 전파**해 호출측이 `replace`를 통째로 건너뛰게 한다. 0페이지(200+`totalCount:0`)와 `_MIN_PAGE_COVERAGE = 0.5` 미달을 각각 문다.

### 1.7 `commodities.get_treasury`의 판정 순서 — **해소(task#269), 형제와 순서가 같아졌다**

⚠️ **아래 옛 서술은 2026-08 재확인에서 거짓으로 판정됐다.** 옛 판은 `get_treasury`가 **백필 → 전량실패 판정** 순서라 저장값이 있으면 전 심볼이 백필돼 판정이 사실상 발동하지 않는다고 적었고, 그래서 "동형 이식" 참조 구현으로 고르지 말라고 경고했다. 그 결함은 **task#269(BH7-L1, `e88e9c2` "도달하지 못하는 가드 2건 — 백필이 판정을 앞지름")에서 교정**됐다.

현재(실측): `commodities.py::get_commodities`·`commodities.py::get_treasury`가 **둘 다 개별 백필 루프 앞**에서 `if not any(results.values())`로 raw fetch 결과를 판정한다. 두 함수의 순서가 같고 둘 다 참조 구현으로 쓸 수 있다. 판정 대상이 백필 *후* `rates`가 아니라 **raw `results`**인 것이 핵심이며, 그 이유가 두 함수 모두 주석으로 박혀 있다.

> 이 항목은 **문서가 코드보다 오래 stale하게 남을 수 있음**을 보여주는 표본이다 — 결함은 task#269에 닫혔는데 이 절·`CONVENTIONS §1.3`·`INTEGRATIONS §10.2`가 전부 옛 서술을 유지해, 「참조로 고르지 말 것」이라는 *지시*가 근거 없이 살아 있었다(자동 게이트는 이 클래스에 원리적으로 블라인드하다).

### 1.8 가드의 baseline을 관용 로더로 읽으면 가드가 스스로 꺼진다 — **이미 가드됨(`_mc_load_strict`, task#329)**

실패 클래스 3종(예외·성공-but-빈응답·부분 페이로드) 밖에 있는 **네 번째 표면**이다. 완전성·커버리지·축소 가드는 전부 직전 저장값을 기준으로 판정하는데, `cache.py::_mc_load`가 조회 예외를 `None`으로 접으므로 **「DB 오류」와 「저장 없음」이 같은 값**이 되고 그러면 기준이 0으로 붕괴해 **판정이 항상 통과**한다. `_mc_save`는 `execute`·`_mc_load`는 `query`라 **SELECT만 실패하고 INSERT는 성공하는 조합이 실제로 성립**하므로 가상의 위험이 아니다.

처방은 `cache.py::_mc_load_strict`(조회 실패를 전파, 행 부재만 `None`)이고 `_mc_load`는 additive로 보존됐다. 소비 4곳과 각각의 선택은 `CONVENTIONS §1.3`에 정리돼 있다 — 그중 `earnings._tickers_with_cache`만 예외를 전파하지 않고 `baseline_known=False`로 **저장만 생략**한다(폴백 체인을 가진 read 경로라 전파하면 일시 DB 오류가 배치를 죽인다 = 가드가 정상 동작을 지우는 형태).

---

## 2. 외부 소스 파싱 취약성

40여 개 `requests.*` 호출 전부에 **명시적 `timeout=`이 있다**(무타임아웃 `requests` 호출 0건 — 이 저장소의 강점). 취약성은 다른 축에 있다: **HTML 스크레이프에 재시도가 하나도 없고**, 실패가 일률적으로 빈 값/last-good으로 변환돼 배치 계층에 안 보인다.

### 2.1 소스별 취약성 인벤토리

| 소스 | fetch 심볼 | 타임아웃 | 재시도 | 폴백 | 실패 시 | 스크레이프? |
|---|---|---|---|---|---|---|
| multpl.com CAPE | `market_indicators/indices.py::_fetch_cape` | 10s | ❌ | last-good | `None` → 저장 CAPE | **HTML — 최고 취약** |
| dataroma 구루 | `guru_scraper.py::scrape_manager_ids`/`scrape_holdings`/`scrape_activity` | 15s | ❌ | ❌ | 명부는 전파, per-manager는 스킵 | **HTML** |
| Finviz 컨센서스 | `scraper.py::scrape_finviz_consensus` | 10s | ❌ | ❌ | `{}` 무음 | **HTML** |
| DART 원문 | `backlog.py::_get_document_text` + `backlog_parser` | 20s | ❌ | ❌ | `""` 무음 | **HTML(XML을 html.parser로)** |
| FnGuide | `market/kr.py` | 8s | ❌ | Naver/DART | per-source except | **HTML** |
| Naver KR | `market/kr.py`, `scraper.py::get_news_kr`, `ranking_service.py` | 8–15s | ref price만 1회 | KIS(ref price만) | `[]`/`{}` | JSON |
| CNN F&G | `market_indicators/sentiment.py::_fetch_fear_greed` | 15s | ❌ | last-good | `None` | 비공식 JSON |
| FRED | `econ.py::_fetch_series`, `macro.py::_fetch_series` | 10s | ❌ | last-good | `stored_data` | JSON |
| KOFIA | `leverage_service.py::_kofia_get`, `lending_service.py::_api_get` | 30s | ❌ | ❌ | raise → 잡이 삼킴 → **success** | JSON |
| 관세청 KITA | `exports.py::_fetch_customs_exports` | 15/30s | ❌ | **UN Comtrade → last-good+stale** | 3단 폴백 | JSON/XML |
| 키움 | `kiwoom/client.py::_request` | 8s | 401/403 → 토큰 재발급 1회 | `configured()` 게이트 | `KiwoomError` | REST |
| KIS | `kis/client.py::_request` | 8s | 401/403 → 1회(60s 재발급 가드) | `configured()` 게이트 | `KisError` | REST |
| yfinance | `cache.py::_yf_close_history`, `beta.py`, `scraper.py`, `consensus_pipeline.py` | **명시 없음** | ❌ | 일부 last-good | 다양 | 라이브러리 |

### 2.2 `scrape_manager_ids`의 무음 절단 — **확인된 버그**(관측 불가 클래스)

`guru_scraper.py::scrape_manager_ids`의 `r.raise_for_status()`는 HTTP 오류만 잡는다. **HTTP 200 + 마크업 변경이면 예외 없이 짧은 명부가 내려온다** — 코드 자신의 docstring(`scrape_all_managers`)이 이 성질을 명시한다. 하류 `storage/schedule.py::save_guru_managers`의 `_ROSTER_MIN_COVERAGE`가 완화하지만 **제거하지는 않는다**. 도달: dataroma가 `a[href*='holdings.php?m=']` 마크업을 바꾸는 순간.

### 2.3 `_fetch_cape`에 stale 마커가 없다 — **잠재 위험**

`indices.py::_fetch_cape`가 markup 변경으로 `None`을 반환하면 `get_indices`가 저장 CAPE로 대체하는데, 응답이 **fresh와 구별되지 않는다**. 형제 `exports.py`는 같은 상황에 `{**stored["data"], "stale": True}`를 싣는다. 몇 달째 얼어붙은 CAPE가 정상값으로 표시될 수 있다.

### 2.4 완전 무음 fetch 실패 — **확인된 버그**(진단 불가)

`services/` 전체에 bare `except:`는 **0건**이고, 대부분의 `except Exception … pass`는 앞에 `logger.warning`이 있다(`pass`는 죽은 코드). 로그가 **전혀 없는** 곳은 3군데:

- **`guru_scraper.py`의 종목명 조회** (MED) — 두 코드(`ticker`, `{ticker}.O`) 시도를 `except Exception: pass`로 삼키고 `""`를 반환한다. 스크레이프 파손과 "Naver에 이름이 없음"이 구별되지 않고, 그 `""`가 구루 보유 종목에 저장된다. `save_guru_managers`의 가드는 *매니저* 단위라 **빈 종목명은 보지 못한다**.
- **`middleware/event_tracker.py::_save_event`** (LOW) — `user_events` INSERT를 완전 무음으로 삼킨다. 추적 사이드채널이라 방어 가능하나 DB 장애 시 신호가 0이다.
- **`main.py::_warm_market_cache`** (LOW) — `get_econ_indicators()`·`get_kr_exports()` 양쪽을 무음으로 감싼다. §3의 TTL 성질과 겹쳐, warm-up 실패는 월배치까지 콜드로 남는다.

좁지만 손실이 있는 것: `earnings.py::_get_naver_quarterly_net_income`의 `except (ValueError, IndexError): pass` — 분기 하나가 무음으로 빠지고 `_merge_quarters`가 짧은 시계열을 합산한다. `_REST_MIN_COVERAGE`는 *데이터가 있는 티커 수*를 세므로 8분기 중 3분기를 잃은 티커도 성공으로 계수된다.

### 2.5 yfinance에 애플리케이션 레벨 타임아웃이 없다 — **잠재 위험**

`cache.py::_yf_close_history`, `beta.py`의 `yf.Ticker(...).info`/`.history(...)` 어느 호출에도 명시 타임아웃이 없다. yfinance 내부 기본값(30s)에 의존하며 `requirements.txt`가 `yfinance>=0.2.40`으로 **상한 없이** 열려 있어(§10.7) 그 기본값이 바뀌면 애플리케이션 쪽 상한이 0이 된다. §6.4의 "잡 타임아웃 없음"과 결합하면 한 번의 hang이 배치 전체를 무기한 잡는다.

---

## 3. NaN/Inf·수치 타입

> 코드 주석 4곳(`main.py`, `routers/stocks.py`×2, `tests/test_stocks_router.py`)이 이 절을 `CONCERNS §3`으로 인용한다 — **번호 유지 필수**.

### 3.1 입력 경로 — **이미 가드됨**

- `main.py::_validation_error_handler`가 422 본문을 `sanitize`한다 → 입력 NaN이 echo돼 직렬화 500이 되는 연쇄가 앱 전역에서 닫혔다.
- Pydantic 스윕: `= Field(None` / `= Field(default=None` **19건 전부 이미 `Optional[...]`** — `x: float = Field(None)` 오선언은 **0건**이다(명시적 `null`만 422가 되는 비대칭 함정 없음).
- 외부 NaN 토큰을 받을 수 있는 float 필드에 `allow_inf_nan=False`가 붙어 있다(`routers/tech_reports.py`, `routers/analyst_reports.py`).

### 3.2 `sanitize`는 `Decimal('NaN')`을 처리한다 — **이미 가드됨**

`services/utils.py::sanitize`가 float뿐 아니라 PostgreSQL `NUMERIC`에서 오는 `Decimal('NaN')`도 잡는다. `NUMERIC` 컬럼이 NaN을 저장할 수 있고 psycopg2가 그대로 왕복시키므로 이 처리가 옳다.

### 3.3 sanitize가 없는 응답 경로 — **잠재 위험**

| 라우터 | 상태 |
|---|---|
| `routers/portfolio.py` | ✅ 전 응답 경로 sanitize + `ConfigDict(allow_inf_nan=False)` |
| `routers/stocks.py` | ✅ `compare_stocks`·대시보드 sanitize, `_usdkrw_rate`에 `math.isfinite` |
| `routers/analysis.py` | ⚠️ `sector`·`macro_correlation`이 sanitize 없음(내부 `isfinite` 가드에 의존) |
| `routers/market_indicators.py` | ⚠️ **14개 GET 중 어느 것도 sanitize 안 함** — 내부 가드가 있는 것(`indices`·`fear_greed`·`kospi_futures`·`kospi_signal`·`leverage`·`lending`)과 없는 것(`treasury`·`commodities`·`fx`·`vix`·`econ`·`macro`·`m7`·`kr_top2`·`kr_exports`)이 섞여 있다 |
| `routers/rankings.py`·`investor.py`·`short_sell.py` | ⚠️ `_serialize`가 bare `_to_float`, sanitize 없음 |

### 3.4 NaN이 `market_rankings`에 저장돼 랭킹 500을 낼 수 있다 — **이미 가드됨**(task#328)

**닫힘.** `services/ranking_service.py::_parse_float`가 `math.isfinite` 가드를 거쳐 비유한값을 `None`으로 떨어뜨리므로 `market_rankings.change_pct`(`NUMERIC`)에 `NaN`이 들어가는 경로가 없다. 즉 이 절이 서술한 연쇄(저장 → `Decimal('NaN')` → sanitize 없는 `routers/rankings.py::_serialize` → starlette `allow_nan=False` → 랭킹 500)의 **첫 고리가 끊겼다**.

같은 라운드에서 인접 2건을 함께 닫았다(적대적 검토):
- `price`는 시세 전용 `_parse_price`로 분리했다 — 실패·비유한·**리터럴 `0`**을 `None`으로 둔다(수량 필드는 `_parse_int`의 `0` 폴백 유지, `CONVENTIONS §1.3.2`). 옛 US 경로 `quote.get("regularMarketPrice") or 0`은 `bool(nan) is True`라 NaN을 통과시켜 뒤이은 `int(price * volume)`가 US 랭킹 배치를 통째로 죽였다.
- `_parse_int`의 except에 `OverflowError`를 넣었다 — `int(float("Infinity"))`는 `ValueError`가 아니다.

**남는 잔여 위험은 §3.3의 sanitize 부재 자체다** — `routers/rankings.py`·`investor.py`·`short_sell.py`의 `_serialize`는 여전히 bare `_to_float`라, 이 소스 가드를 우회해 다른 경로로 들어온 `Decimal('NaN')`은 그대로 500이 된다. 소스 가드가 있다고 §3.3 행을 지우지 말 것.

### 3.5 최소카드 폴백이 근본원인을 마스킹한다 — **설계상 트레이드오프**

`routers/stocks.py`의 대시보드 빌드는 per-card `_safe`로 throw를 `_minimal_card`로 흡수한다 — 500-to-empty를 막는 올바른 설계지만, **enrichment가 조용히 사라지는 형태**로 실패한다(에러 토스트 없음). 헤더·시세는 정상인데 RSI·컨센서스·매물대·배당만 일괄 blank면 `docker logs portfolion-backend-1 | grep '최소카드 폴백'`이 유일한 단서다.

---

## 4. DB·스키마·트랜잭션·커넥션 풀

### 4.1 `app_schema.sql` ↔ `main._migrate` 미짝 — **잠재 위험**(프로세스 부채)

`app_schema.sql`은 **빈 `pgdata` 초기화 시에만** 적용된다(`docker-compose.yml`의 `/docker-entrypoint-initdb.d/02-app.sql`). `backend/migrations/001_user_events.sql`·`002_backlog_history.sql`은 **어떤 스크립트·compose·모듈도 참조하지 않는다**(죽은 수동 파일). 따라서 `_migrate()`가 유일한 자동 경로다(ADR-0006).

**`_migrate`에 `CREATE TABLE IF NOT EXISTS`가 없는 후발 테이블** — 라이브 DB엔 수동 `psql`로만 존재한다:

| 테이블 | 근거 |
|---|---|
| `market_rankings` | 랭킹 Phase 3에서 추가, `_migrate` 무등록 |
| `market_investor_trend` | 수급 Phase 4에서 추가, `_migrate` 무등록 |
| `market_leverage_indicators` | `_migrate` 무등록 |
| `job_runs` | `app_schema.sql` 자신이 수동 단계임을 주석으로 명시 |
| `raw_reports`·`daily_consensus_mart`·`user_events`·`backlog_history` | `_migrate`에 `ALTER`만 있고 `CREATE`는 없음(`backlog_history.segments`) |

`market_lending_balance`는 안전하다 — `lending_service.py::_ensure_table`이 매 호출 자가 생성한다.

**`tickers` 컬럼 중 `_migrate`에 짝이 없는 것**: `_migrate`가 덮는 것은 `key_resource`·`competitor_edge`·`market_outlook`·`analyst_target` 4개뿐. 누락: **`enriched_at`**(`routers/stocks.py::_enriched_at_map`가 읽음), **`is_etf`**(`storage/portfolio.py::get_full_portfolio`), **`insights`**(`storage/portfolio.get_stocks`) — 셋 다 초기 스키마 이후 추가분이다. 나머지(`exchange`·`competitors`·`moat`·`growth_plan`·`risks`·`recent_disclosures`)는 초기 스키마 소속이라 위험이 낮다.

`user_stocks`(`target_price`·`stop_price`·`target_weight`·`pinned`)는 **올바르게 짝지어져 있다**.

심각도 주석: 앱이 지금 돌고 있으므로 라이브 DB엔 이미 수동 반영돼 있을 가능성이 높다. 노출은 **옛 덤프에서의 재구축**이나 **두 번째 환경**이고, 위반되는 것은 명시된 DoD다.

### 4.2 커넥션 풀 vs ThreadPool 적층 — **잠재 위험**

> `services/db.py`의 주석이 이 항목을 `CONCERNS §4.2`로 인용한다.

`_get_pool()`은 `ThreadedConnectionPool(minconn=1, maxconn=20)`이고, **psycopg2 풀은 소진 시 블록하지 않고 `PoolError`를 던진다**(코드 주석이 이 성질을 명시).

| 사이트(심볼) | 워커 | DB 접근 |
|---|---|---|
| `routers/calendar.py::get_calendar_events` (`_fetch_stock`) | 15 | ❌ yfinance만 |
| `services/ranking_service.py::_fetch_naver_market` | 12 | ❌ HTTP만 |
| `routers/stocks.py` 대시보드 (`_build_all`→`_build_card`) | 10 | ✅ 카드당 `dividends.get_dividend` |
| `services/analysis_service.py::get_macro_correlation` | 10 | 혼합 |
| `scheduler/jobs.py::_investor_trend_work` / `_short_sell_work` | 8 | ✅ `upsert_trend` |
| `routers/stocks.py::backfill_names` (`_one`) | 8 | ✅ 쓰기 2회 |
| `services/report_generator.py` | 8 | ✅ |
| `market_indicators/earnings.py` | 20 | ❌ |
| `services/consensus_pipeline.py` | 5 | ✅ |

도달: 동시 대시보드 요청 2건(10+10=20=`maxconn`) + 스케줄러 배치 1개 → `PoolError`. 부하 실증은 없어 **미확정**이지만, 이 위험이 데이터 손실로 승격되는 경로가 §1.2다 — `_mc_load` 안의 `PoolError`가 "저장값 없음"으로 변환된다.

**스테일 주석 3곳**(LOW, 확인): `scheduler/jobs.py`(2곳)·`routers/stocks.py`가 풀을 `maxconn=10`으로 서술한다(실제 20). 다음 사람이 읽을 사이징 근거이므로 정정 대상.

### 4.3 트랜잭션 원자성 — **이미 가드됨**(지시문의 전제가 틀렸다)

`services/db.py::get_connection`은 **커밋과 롤백을 모두** 한다:

```python
conn = _get_pool().getconn()
try:
    yield conn
    conn.commit()
except Exception:
    conn.rollback()
    raise
finally:
    _get_pool().putconn(conn)
```

따라서 "정상 종료 시 커밋한다 → 롤백 전제 코드가 성립하지 않는다"는 **반증됐다**. §1.4의 delete-rewrite 5곳은 이 롤백에 정당하게 의존한다.

**진짜 잔여 위험은 다른 곳이다** — `query()`/`execute()`는 **각각 자기 커넥션·자기 트랜잭션**을 연다. 따라서 `execute()` 루프에는 문장 간 원자성이 없다: `leverage_service.py::_upsert_rows`, `lending_service.py::_upsert`. 멱등 `ON CONFLICT` upsert라 실무상 무해하지만 루프 중 크래시는 부분 날짜 범위를 남긴다.

**같은 성질에서 나온 결함 2건은 닫혔다**(task#330). 이 절이 leverage/lending 루프만 잔여위험으로 인정했던 것이 그 둘을 「기록된 트레이드오프」로 오독시키는 토양이었다:

- ~~`routers/admin.py::delete_user`~~ (B5) — 확인 `query` 1 + `execute` 6 = **독립 트랜잭션 7개**라 중간 실패가 「로그인은 되는데 종목·권한이 전부 사라진 계정」이나 고아 행을 영구히 남겼다. 멱등 upsert와 달리 **되돌릴 수 없는 DELETE**라 실무상 무해하지 않다. 한 커넥션의 단일 트랜잭션 + 가드 read `FOR UPDATE`(확인과 삭제가 다른 트랜잭션이면 그 틈의 admin 승격이 403을 우회한다).
- ~~`storage/schedule.py::save_guru_managers`~~ (B68) — 읽기-병합-쓰기가 트랜잭션·락 없이 돌아 동시 크롤이 서로의 병합결과(드롭/백필 판정)를 덮었다. docstring의 「드롭은 영구 삭제가 아니다 — 다음 정상 크롤이 복원」은 **클로버가 안 난다는 보장이 아니다**.

### 4.4 SQL 인젝션 — **이미 가드됨(클린)**

동적 SQL 3곳 전부 안전하다:
- `routers/admin.py::delete_user` — `f"DELETE FROM {table} WHERE {col} = %s"`의 `table`/`col`은 **하드코딩 리터럴 리스트**(`_USER_DELETE_TARGETS` 모듈 상수) 순회, `user_id`는 파라미터화. 그 상수에 외부 입력을 넣지 말 것 — 안전성의 근거가 전부 「리터럴이다」에 걸려 있다.
- `storage/portfolio.py::enrich_stock` — `set_clause`를 키에서 만들지만 그 앞에 `if not fields.keys() <= _ENRICH_KEYS: raise ValueError`(frozenset allowlist). 올바른 allowlist-then-interpolate.
- `services/analyst_reports.py` — `_COLS`가 모듈 상수.

나머지 전 DB 호출은 `%s` 파라미터화. `.format()`이 SQL에 닿는 곳은 없다(4건 전부 DART 뷰어 URL 템플릿).

### 4.5 N+1 — **설계상 트레이드오프**

대시보드가 카드당 개별 read(`dividends.get_dividend` 등)를 한다. 10워커 병렬로 완화하지만 그 병렬성이 §4.2의 풀 압력을 만든다 — 두 문제가 서로의 완화책이다.

---

## 5. 인증·보안 노출

### 5.1 무인증 엔드포인트 — **이미 가드됨(드리프트 0)**

전 22개 라우터의 route 데코레이터를 파싱해 4종 auth 의존성(`get_current_user`·`get_current_user_or_api_key`·`require_admin`·`require_admin_or_api_key`)과 대조한 결과 — **무인증 `/api` 엔드포인트는 정확히 9개, 전부 `routers/auth.py` 소속**이다:

`POST /api/auth/register`·`login`·`refresh`·`logout`, `GET /api/auth/oauth/google`·`google/callback`·`github`·`github/callback`·`token`. (+ `/api` 밖의 `GET|HEAD /health`.)

**사용자·포트폴리오 데이터를 노출하는 무인증 엔드포인트는 0건이다.**

`tests/test_no_public_reads.py`의 `ALLOWED_PUBLIC` frozenset이 정확히 이 9개이고, **양방향으로 강제한다**(신규 공개 라우트 금지 + stale 엔트리 금지). 게다가 `test_route_walk_is_not_silently_empty`가 `len(api_routes) > 100`을 단언해 **FastAPI 버전차로 route walk가 0건이 되며 게이트가 거짓 통과하는 실패 모드**(§9)까지 막는다. `tests/test_security_auth_gaps.py`가 override 없는 fresh app으로 실제 401을 확인한다(API 키 positive/negative 포함). ADR-0029.

**이 절은 재제기 금지 대상이다.** 아래 5.2~5.10은 게이팅이 아닌 축의 문제다.

### 5.2 프론트가 URL 쿼리의 토큰을 신뢰한다 — **닫혔다**(구 B44)

`frontend/src/hooks/useAuthBootstrap.js::useAuthBootstrap`가 URL 쿼리의 `token`·`refresh`를 그대로 `localStorage`에 심던 레거시 분기(어떤 백엔드 경로도 만들지 않는 형태 — 콜백은 `?oauth=<code>`만 낸다)를 **분기 자체를 삭제**해 닫았다(task#290 S1). 분기는 `oauthCode`(정상 교환)·`oauthError`·그 외(`resolveStored` 고정) 3갈래만 남는다. 세션 고정 경로 자체가 없어졌으므로 잔여 위험 없음.

### 5.3 OAuth `state`가 세션 바인딩·일회용이 아니다 — **잠재 위험**

`routers/auth.py::_make_state`/`_verify_state`는 순수 HMAC이다 — `_make_state`가 `nonce.hmac_sha256(nonce)[:20]`을 만들고 `_verify_state`는 HMAC을 재계산할 뿐이다.

- **서버측 저장소 없음, 재사용 방지 없음, 만료 없음**(state TTL = 무한).
- **세션 바인딩 없음** — `SessionMiddleware`가 설치돼 있지만 `oauth_google`/`oauth_github`가 nonce를 `request.session`에 쓰지 않는다.
- **PKCE 미사용**(`code_challenge`/`code_verifier` 없음).

서명 검사가 증명하는 것은 "이 서버가 언젠가 어떤 state를 발행했다"이지 "이 브라우저가 이 플로우를 시작했다"가 아니다. 도달: 공격자가 `/api/auth/oauth/google`을 한 번 눌러 만료되지 않는 state를 확보한 뒤, 자기 `code` + 그 state로 만든 콜백 URL을 피해자에게 먹인다(로그인-CSRF). HMAC 20 hex(80비트) 절단 자체는 약점이 아니다 — **nonce 저장소 부재가 약점이다**. (전에는 B19(§5.5)와 겹쳐 서명 자체가 위조 가능했다. B19은 task#326에서 닫혔으므로 **지금 남은 것은 nonce 저장소 부재 하나**다 — 이 절을 「키를 모르는 공격자도 state를 만들 수 있다」로 읽지 말 것.)

### 5.4 OAuth 코드가 URL 쿼리로 전달된다 — **설계상 트레이드오프**(완화 있음)

콜백이 `f"{frontend}/?oauth={code}"`로 리다이렉트하고 프론트가 `GET /api/auth/oauth/token?code=…`로 교환한다. 완화는 실재한다: 120초 TTL + `_pop_oauth_tokens`의 단일 사용 `pop`, `_no_cache_redirect`의 `Cache-Control: no-store`, 프론트의 즉시 `history.replaceState`. 그럼에도 코드는 브라우저 히스토리·서드파티 서브리소스의 `Referer`·중간 접근 로그에 남는다. 120초 안에 그것을 읽는 자는 1시간 access token + 30일 refresh token을 얻는다.

부수(LOW): `_oauth_codes`는 프로세스 로컬 dict라 uvicorn 워커가 2개 이상이면 콜백과 교환이 다른 프로세스에 떨어져 로그인이 간헐 실패한다(현재는 단일 워커라 미발현 — §6.6).

### 5.5 하드코딩 폴백 시크릿 — **해소**(task#326, 구 B19)

**옛 형태**: `routers/auth.py`의 모듈 레벨 `_HMAC_SECRET = os.environ.get("SESSION_SECRET", "<리터럴 기본값>").encode()`.

백엔드에서 **유일한** 하드코딩 시크릿 기본값이었다(`JWT_SECRET`은 `os.environ[...]` fail-fast를 3곳 모두 지킨다). `main.py`가 `os.environ["SESSION_SECRET"]`으로 import 시 KeyError를 내므로 `main.py`를 거친 서버는 기본값으로 뜨지 못했으나, **import 순서상 `routers.auth`가 먼저 평가되고 `_HMAC_SECRET`이 import 시점에 고정**되므로 `main`을 거치지 않는 진입점(테스트 하니스·스크립트·향후 워커)은 공개적으로 알려진 키로 OAuth state를 서명했다.

**현 형태**: `routers/auth.py::_hmac_secret`이 **호출 시점**에 `os.environ.get("SESSION_SECRET")`을 읽고 미설정이면 `RuntimeError`를 던진다 — 리터럴 폴백이 없다. 임포트타임 raise는 **일부러 하지 않았다**(그러면 `main.py` 밖 진입점의 임포트가 통째로 막힌다). 그래서 이 모듈은 여전히 어디서든 임포트되지만, 서명·검증을 *실제로 시도할 때* 비밀이 없으면 조용히 약한 키로 서명하는 대신 실패한다(`wrong < missing`). 가드: `backend/tests/test_session_secret_no_fallback.py`. **잔여**: §5.3의 nonce 저장소 부재는 이 변경과 무관하게 그대로다.

### 5.6 레이트리밋 전무 — **확인된 버그**(ADR 근거 없는 순수 공백) (B20)

`backend/`에 `slowapi|ratelimit|rate_limit|limiter|throttle` 계열 애플리케이션 레이트리밋이 **하나도 없다**(발견되는 것은 외부 제공자 보호용 아웃바운드 스로틀뿐: `agm.py::_DART_THROTTLE`, KIS/키움 sleep). `login`·`register`·`refresh`·`oauth_token_exchange` 어디에도 없다.

- **`POST /api/auth/login`** — 무제한 크리덴셜 스터핑(락아웃·백오프·CAPTCHA 없음). 더 나쁜 것은 `verify_password`가 **의도적으로 비싼 bcrypt**라는 점이다: 같은 무제한 엔드포인트가 CPU 고갈 DoS가 된다. FastAPI가 sync 핸들러를 유계 스레드풀에서 돌리므로 수백 건 동시 위조 로그인이면 API 전체가 정지한다. **계정 없이 가능한, 이 저장소에서 가장 싼 가용성 공격이다.**
- `POST /api/auth/refresh`·`GET /api/auth/oauth/token` — 토큰이 `secrets.token_urlsafe(64)`/`(24)`라 추측은 비현실적. 노출은 DB 부하다.

### 5.7 admin 게이팅 공백 — **3건 닫힘(구 B45·B46·B50), 1건 잔존(`days` 상한) + 알려진 UI 비일관 1건**

전역 상태를 바꾸는데 게이팅이 약했던 자리:

- **닫힘(구 B45) `routers/report.py::put_backlog`** — `PUT /report/{ticker}/backlog`의 게이트를 `get_current_user_or_api_key`→**`require_admin_or_api_key`**로 좁혔다(task#290 S2). `save_llm_backlog(ticker, entries)`가 ticker 스코프(전역 공유)라는 사실은 그대로지만, 이제 admin 로그인 또는 API 키만 도달한다. 형제 `refresh_backlog`(`require_admin`)와 정합됨. `entries: list = Body(...)`에 `max_length` 상한이 없는 것은 그대로 남는다 — task#290의 비목표.
- **닫힘(구 B46) `routers/stocks.py::clear_dashboard_cache`** — 게이트(`get_current_user`)는 유지하되 `cache_svc.invalidate_dashboard(user_id)`로 **호출자 자신의 캐시만** 무효화하도록 스코프를 좁혔다(task#290 S3, `_dashboard_cache.invalidate`는 이미 `user_id` 인자를 받고 있었다 — 호출부만 무인자였다). 대조군 `routers/calendar.py::delete_calendar_cache`와 이제 동형.
- **닫힘(구 B50) `routers/report.py::refresh_analyst`·`::backfill_consensus`** (task#291) — 둘 다 `user_id: str = Depends(get_current_user)`를 받아놓고 본문에서 안 쓰던 것이 결함이었다(형제 `::generate_one`은 `find_ticker(storage.get_all_stocks(user_id), ticker)`로 소유권 검사가 있었는데 이 둘엔 없었다). **두 엔드포인트는 이제 같은 가드를 공유한다** — `routers/report.py::_require_owner_or_admin`(소유권 OR admin, caller 조회 실패는 fail-closed)를 본문 선두, 스냅샷 `query`보다 **먼저** 호출한다. 거부는 둘 다 403이고 DB에 닿지 않으므로 무쓰기다. admin이 소유권을 우회해야 하는 이유는 리포트 목록 `scope=all`("그외" 탭)로 남의 종목 상세를 열기 때문이다(`list_reports`의 role 판정과 같은 패턴).
  - ⚠️ **`require_admin`으로 좁히지 말 것 — 실제로 그렇게 구현했다가 배포 전에 되돌렸다.** 두 엔드포인트 모두 프론트 소비처가 있고(`components/reports/DetailTab.jsx`의 「데이터 갱신」 · `components/reports/ConsensusChart.jsx`의 「백필」) **둘 다 role 게이팅이 없다**(grep 0). admin 전용으로 좁히면 전 비admin 사용자가 **자기 보유 종목에서도** 403을 받는 **기능 회귀**다. task#291 계획은 `backfill_consensus`에 대해 "프론트 소비처 없음(grep 0)"이라는 **틀린 전제**로 `require_admin`을 채택했고(같은 계획이 `refresh_analyst`에는 정확히 반대 논리를 적었다), 적대적 리뷰가 배포 전에 잡았다. **게이트를 조이는 변경은 그 엔드포인트의 프론트 소비처를 직접 grep해 role 게이팅 유무를 대조할 것** — pytest·vitest·빌드 어느 것도 이 경로를 원리적으로 못 본다.
- **알려진 UI 비일관(닫지 않음 — task#291 결정)** — 비admin이 **랭킹**(`pages/Ranking.jsx::onRowClick` → 모달 → `ReportDetailTabs`)에서 **비소유** 종목 상세를 여는 것은 지원되는 내비게이션인데, 그 화면의 「데이터 갱신」·「백필」 버튼은 소유권·role을 보지 않으므로 누르면 403이 뜬다. 실패는 `refreshError`로 graceful하고 공유 데이터는 보호되므로 **게이트 결함이 아니라 버튼 가시성 문제**다. 프론트에서 숨기려면 `GET /report/{ticker}/{date}` 응답(현재 소유권 필드 없음)에 `is_mine`을 additive로 추가하고 admin 판정까지 내려야 해서 계약이 늘어난다 → 별도 태스크로 남긴다. task#97/#103의 "버튼은 보이는데 핸들러가 거부"와 같은 가족.
- **잔존 `routers/report.py::backfill_consensus`의 `days` 상한** (LOW) — `days: int = 180`은 여전히 **`Query(..., le=…)` 상한 없는 bare int**다(형제 `short_sell.py`·`investor.py`는 `Query(252, ge=1, le=1000)`으로 규율돼 있다). 소유권 게이트가 붙어 **남의 종목으로는 못 부르지만, 자기 보유·관심 종목에는 임의 인증 사용자가 큰 `days`로 외부 제공자를 호출시킬 수 있다** — 도달성은 **좁아졌을 뿐 닫히지 않았다**(옛 판의 "도달성만 닫힘" 서술은 `require_admin`을 전제한 것이라 무효). 상한 추가는 task#290·#291 둘 다 비목표.

반대로 **비싼 배치 엔드포인트 다수는 올바르게 `require_admin`이다** — 게이팅 규율 자체는 좋고, 위 잔존 1건(days 상한 코드 자체)만 예외다. ⚠️ 이 절 이전 판의 "28/31" 분모·분자는 산출 방법이 문서에 남아 있지 않아 `backfill_consensus`의 게이트 교체를 반영해 그대로 갱신하지 않았다(task#291 S3 — 추정 대신 재감사가 필요한 수치로 남겨둔다). `POST /api/admin/cowork/fire`는 고정 env URL(`COWORK_ROUTINE_FIRE_URL`)로만 POST하므로 **SSRF 없음**.

### 5.8 API 키 비교가 상수시간이 아니다 — **잠재 위험**(낮음)

`backend/auth.py::get_current_user_or_api_key`: `if expected and api_key == expected:` — 평문 `==`(첫 불일치 바이트에서 단락). 같은 저장소의 `routers/auth.py::_verify_state`는 `hmac.compare_digest`를 올바르게 쓰므로 프리미티브를 모르는 게 아니라 여기 적용을 빠뜨린 것이다. HTTP 상의 원격 타이밍 오라클은 지터에 묻혀 실 exploit이 어려워 MED가 아닌 LOW-MED. 수정은 한 줄.

**fail-closed는 올바르다** — `expected and …` 가드 덕에 `COWORK_API_KEY` 미설정 시 모든 키 시도가 401이지 `""` 매치가 아니다.

**`require_admin`은 API 키를 거부한다** — `Depends(get_current_user)`만 선언하고 `get_current_user`는 `X-API-Key`를 보지 않는다(CLAUDE.md의 서술이 맞다). 분리는 의도적이고 깨끗하다.

### 5.9 가입이 열려 있고 비밀번호 정책이 없다 — **잠재 위험**

`routers/auth.py::RegisterRequest`는 `email: str` / `password: str` — **`EmailStr`이 아니고 `min_length`도 `Field` 제약도 없다**. 이메일 검증·초대 게이트·레이트리밋 없음. 빈 문자열 비밀번호가 통과한다. 신규 계정은 즉시 `apply_default_permissions`를 받는다. §5.6(로그인 레이트리밋 부재)과 결합하면 약한 비밀번호가 직접 브루트포스 가능하고, §5.7의 두 전역 표면이 계정 하나당 지렛대가 된다.

### 5.10 토큰 수명·저장 — **설계상 트레이드오프 + 잔여**

- **해싱은 올바르다** — `auth_service.py::hash_password`/`verify_password`가 bcrypt + per-hash `gensalt()`. 커스텀 암호 없음.
- **JWT는 깨끗하다** — `algorithms=["HS256"]`이 **4개 decode 지점 전부**에 고정, `verify=False`·options override 없음. alg=none/혼동 클래스는 닫혀 있다.
- **리프레시 회전은 있다** — `auth_service.py::consume_refresh_token`이 반환 전 `DELETE`하고 테스트가 못박는다. 만료도 강제한다(naive→UTC 보정 포함).
- **잔여 1: 재사용 탐지 없음** — 회전된 토큰이 재생되면 `None`을 반환할 뿐 그 사용자의 토큰 패밀리를 무효화하지 않는다(RFC 6819의 표준 대응은 전량 폐기).
- **잔여 2: access token 폐기 불가** — `jti` 없음·denylist 없음이라 `logout` 후에도 탈취된 access token이 최대 1시간 산다.
- **잔여 3: `localStorage` 저장** — access/refresh 둘 다. HttpOnly 쿠키 미사용(콜백이 `Set-Cookie`를 아예 안 낸다). XSS 1건이 세션이 아니라 **30일 지속 계정 탈취**가 된다.
- 로그인 사용자 열거(LOW): 미존재 사용자 분기가 bcrypt를 **돌리지 않고** 반환해 응답 시간이 갈린다(메시지는 동일).

### 5.11 CORS — **이미 가드됨**

`main.py`가 명시 origin 리스트를 쓰고 wildcard가 없으며 falsy 필터가 빈 `FRONTEND_URL` 주입을 막는다. **`allow_credentials`를 설정하지 않아 기본 `False`** — wildcard+credentials 문제 없음. 인증이 `localStorage`의 `Authorization` 헤더로 타므로 credentialed CORS가 불필요하다는 점에서 아키텍처적으로도 일관된다. (사소: 두 `localhost` 개발 origin이 프로덕션 allowlist에 실려 있다.)

### 5.12 Google `id_token`을 서명 검증 없이 파싱 — **잠재 위험**(현재 미도달)

`routers/auth.py::oauth_google_callback`가 `id_token`을 `.split(".")[1]` + base64 디코드로 읽는다 — `jwt.decode` 없음, `aud`/`iss`/`exp` 검증 없음. **지금은 exploit 불가**다: 토큰이 `GOOGLE_CLIENT_SECRET`로 인증된 서버-대-서버 POST(TLS)로 오므로 전송 자체가 신뢰 앵커다. 누군가 이것을 클라이언트가 준 `id_token`을 받도록 리팩터하는 순간 실 취약점이 된다 — 불변식을 주석으로 못박을 자리다.

### 5.13 이벤트 화이트리스트 — **B24 닫힘, 잔여 1건**

`routers/events.py::VALID_EVENTS`(**20개** — task#331에서 `nav_analytics` 추가)는 `Depends(get_current_user)`로 게이트되고 비화이트리스트 이름은 **200 OK + 무음 폐기**다(fail-silent 설계).

- **B24 — 닫힘(task#331)**: 프론트가 보내는데 화이트리스트에 없는 이벤트는 이제 **0개**다(전엔 `nav_analytics` 1개 — `components/Masthead.jsx`, `components/MobileTopActions.jsx`). 200을 돌려주므로 이 대조 없이는 관측 불가였고, 그래서 `backend/tests/test_valid_events_matches_frontend.py`가 **3방향**을 자동 대조한다 — ⓐ 프론트 수확 ⊆ 화이트리스트 ⓑ 화이트리스트 잔여 == `RETIRED_EVENTS` 베이스라인 ⓒ **`AdminAnalytics.jsx::EVENT_LABELS` ⊇ 화이트리스트**(라벨이 없으면 `eName` 폴백이 원시 영문 키를 렌더한다 — graceful이라 어떤 게이트도 안 알린다). ⚠️ 수확기 정규식의 인용부호는 단·쌍·백틱을 모두 받는다 — 좁히면 「새 이벤트를 쌍따옴표로 정의하고 화이트리스트 등록을 잊은 경우」에만 무음이 되어 감사가 재발 방향에서만 공허해진다.
- 스테일 엔트리(LOW): `tab_holdings`·`tab_watch`·`stock_search`는 `pages/AdminAnalytics.jsx`의 표시 라벨로만 등장하고 emit 하는 `trackEvent` 호출부가 없다. **화이트리스트에서 빼지 않는다** — 캐시된 옛 PWA 번들이 아직 쏠 수 있고, 빼는 순간 그 텔레메트리가 무음 폐기된다(= 이 절이 막으려는 바로 그 클래스). `RETIRED_EVENTS` 베이스라인이 그 셋을 exact-match로 동결한다.
- 동적 emit은 안전하다 — `MobileNav.jsx`의 `trackEvent('nav_' + section.perm)`이 내는 5개 perm 값이 전부 화이트리스트에 있다(§7.4의 "필드 역할 겸직" 함정을 `perm`으로 파생해 피한 자리).
- **화이트리스트가 `user_events`의 완전한 인벤토리가 아니다**: `middleware/event_tracker.py::EventTrackerMiddleware`가 `stock_add`·`stock_delete`·`stock_promote`·`report_generate`·`guru_crawl`을 `_save_event`로 직접 INSERT하며 화이트리스트를 우회한다(이름이 `_TRACKED`에 하드코딩이라 취약점은 아니다).

---

## 6. 배치·스케줄러·관측성

### 6.1 키 미설정·실패가 "성공"으로 기록된다 — **부분 해소** (B6, task#329)

**실측(2026-08-22): `_JOB_FUNCS` 32개 중 `set_status` 배선 14개 · 미배선 18개.** 미배선 잡은 본문을 `try/except Exception: logger.warning(...)`로 감싼 채 `with job_runs.record(...)` 안에 있어 **항상 `_finish("success")`가 돈다**. `services/job_runs.py`의 docstring이 이 성질과 배선 예외 목록을 스스로 명시한다(그 목록이 정본이다).

미배선 18개(job id): `daily_report_kr`·`daily_report_us`·`daily_digest`·`monthly_kr`·**`macro_signals_fetch`**·`leverage_fetch`·`lending_fetch`·`investor_trend_fetch`·`short_sell_fetch`·`supply_score_fetch`·`backlog_fetch`·`kr_sector_fetch`·`disclosure_fetch`·`agm_fetch`·`dividend_fetch`·`beta_fetch`·`insider_fetch`·`us_supply_fetch`.

옛 판이 인용한 최악 형태(`_refresh_monthly_us`가 키 미설정 `{"error": …}`를 검사하지 않아 "refreshed" 로그까지 찍던 것)는 **해소됐다** — 지금은 auto·manual 3레인이 모두 반환값을 검사해 `run.set_status("skipped", …)`를 기록한다:

```python
with job_runs.record("monthly_us", "auto") as run:          # ← as run 배선
    data = _fetch_and_save_econ_indicators() or {}
    if "error" in data:            run.set_status("skipped", data["error"])
    elif data.get("_status"):      run.set_status(data["_status"])   # partial|skipped
    else:                          logger.info("[Scheduler] Econ indicators refreshed")
```

> ⚠️ **B6의 나머지 절반은 열려 있다 — `macro.py::_fetch_and_save_macro_signals`.** 그 함수는 키 미설정 시 여전히 예외 없이 `{"error": …}`를 반환하고 `_status`를 실지 않으며, 두 레인 **모두** 반환값을 검사하지 않는다(`scheduler/jobs.py::_refresh_macro_signals` — `as run` 없음 · `routers/market_indicators.py::refresh_macro_signals` — `as run` 없음). 즉 `FRED_API_KEY`가 없으면 `macro_signals_fetch`는 지금도 **매 실행 success**로 기록된다. 형제 `econ.py`가 같은 wave에서 계열별 소스-폴백 + `_status` 3상태로 고쳐졌으므로 **그 파일이 그대로 참조 구현**이다.

키 미설정 → 초록 배치 + 데이터 0의 조합(전수):

| 환경변수 | fetch 심볼 | 잡 |
|---|---|---|
| `FRED_API_KEY` | ~~`econ.py::_fetch_and_save_econ_indicators`~~(해소) · `macro.py::_fetch_and_save_macro_signals`(**열림**) | ~~`_refresh_monthly_us`~~(배선됨) · `_refresh_macro_signals`(**미배선**) |
| `DART_API_KEY` | `disclosures.py`, `backlog.py::_get_corp_code_map`, `agm.py`, `dividends.py`, `insider_trades.py` | `_fetch_disclosures`·`_fetch_backlog`·`_fetch_agm`·`_fetch_dividends`·`_fetch_insider` |
| `KOFIA_API_KEY` | `leverage_service.py::_kofia_get`, `lending_service.py::_api_get` | `_fetch_leverage`·`_fetch_lending` |
| `TELEGRAM_BOT_TOKEN`/`_CHAT_ID` | `digest_service.py::send_telegram`(bare `return`) | `_run_digest` — 다이제스트는 생성·저장되고 **발송만 안 된다** |

도달: `backend/.env.docker`가 재생성·절단되는 모든 배포. `.env.docker`가 gitignored이므로 **새 클론 + `deploy.sh`가 정확히 이 상태를 만든다** — 전 배치 초록, 데이터 0. 이번 판에서 가장 가치 높은 운영 발견이다.

### 6.2 `job_runs`에 "스킵" 상태가 없다 — **설계상 트레이드오프**(관측 공백)

§1의 가드들이 발동하면 저장을 건너뛰는데, 잡 본문이 예외를 전파하지 않으므로 `job_runs`는 **success로 기록한다**. 즉 "갱신됨"과 "생략·직전값 유지"가 관측상 구별되지 않는다.

**진척(2026-08-22, task#329): 배선 1 → 14, 미배선 18.** `_run_guru_crawl` 외에 FRED 경제지표 3레인·환율 2레인·발굴 추천 2레인·랭킹 2레인·US 섹터·코스피 신호·실적 2종(예외만)이 `partial`/`skipped`/`failed`를 쓴다. 남은 18개가 채택해야 할 패턴이며, `_status`를 반환값에 실어 auto·manual **두 레인 모두**에서 받는 형태가 정본이다(`econ.py` + `scheduler/jobs.py::_refresh_monthly_us` + `routers/market_indicators.py::refresh_econ`/`refresh_monthly` 3쌍).

⚠️ **"배선됨"이 "완전"을 뜻하지 않는다** — `_refresh_earnings_kr`/`_refresh_earnings_us`는 **예외만** 배선돼 있고, 본문의 저장 생략 4경로(고정집합 불완전·rest 유니버스 공백·rest 커버리지 미달·마감분기 없음)는 직전 저장값을 그대로 반환하므로 반환값으로 구별할 수 없어 여전히 success로 기록된다(선재 부채).

### 6.3 `get_or_refresh`의 `ttl`은 저장값에 안 걸린다 — **설계상 트레이드오프**(오해 유발 시그니처)

```python
def get_or_refresh(key, fetch_fn, ttl, force=False):
    if not force:
        cached = _get_cache(key)
        if cached: return cached
        stored = _mc_load(key)
        if stored:
            _set_cache(key, stored["data"], ttl)   # ttl → 인메모리 만료 전용
            return stored["data"]
    return fetch_fn()
```

`stored["fetched_at"]`은 로드되고 **어디와도 비교되지 않는다**. 어떤 나이의 DB 행이든 이긴다.

**그리고 `force=True` 탈출구는 사실상 존재하지 않는다** — 비테스트 `backend/` 전체에서 `force=True`는 `kis/client.py`·`kiwoom/client.py`의 OAuth 토큰 재발급 2건뿐이다. **어떤 배치·라우터·스케줄러도 `get_or_refresh`에 `force=True`를 넘기지 않는다.** 배치들은 `_fetch_and_save_*`를 직접 불러 우회하므로 동작은 하지만, 결과적으로 `get_or_refresh`의 실사용 소비자는 read 경로 2개(`get_m7_earnings`·`get_kr_top2_earnings`)뿐이다.

### 6.4 `market_cache` 16개 키의 신선도 경계 — **§6.3의 실측 귀결**

| 키 | 신선도를 실제로 묶는 것 |
|---|---|
| `commodities`·`treasury`·`indices`·`vix`·`fear_greed`·`kospi_futures` | 인메모리 3600s 만료 후 **요청 경로 재fetch**(소비자가 곧 갱신자라 자가치유) |
| `econ_indicators`·`kr_exports`·`macro_signals`·`kospi_signal`·`m7_earnings`·`kr_top2_earnings`·`kr_sector_momentum`·`us_sector_momentum` | 스케줄러 배치 |
| `sp500_tickers`·`kospi_tickers` | 자체 `_is_fresh()` — **이 모듈의 유일한 나이 검사**이고 파일 mtime이 아닌 `fetched_at`을 올바르게 쓴다 |
| `fx` | 스케줄러 배치 `fx_fetch`(매일 06:40 KST) ← **B41 해소(2026-08)**. 나이 검사는 여전히 없고, 대신 배치가 「신선한 심볼 수」로 `job_runs` 상태(success/partial/skipped)를 기록한다 |

**B41 — 키 `fx`에 배치도 나이 검사도 없었다(해소).** ⚠️ **아래 서술은 2026-08 이전 상태다.** 지금은 `fx_fetch` 배치가 `_JOB_FUNCS`에 있고 `batch_registry.BATCHES`에도 등록돼 있다(`market="공통"`). 나이 검사(소비 시점의 stale 마커)는 아직 없으므로 소비자 목록 자체는 유효하다. — 옛 서술: 작성자 `market_indicators/fx.py::get_fx`는 `routers/market_indicators.py`의 `GET /api/market/fx`와 admin refresh에서만 도달한다(`_JOB_FUNCS`에 fx 잡 없음, `main._warm_market_cache`는 econ·exports만 warm). 그런데 소비자는 나이 검사 없는 raw `_mc_load("fx")` 3곳이다:

- `routers/stocks.py::_usdkrw_rate` → 대시보드 `totals`
- `routers/portfolio.py` — `get_dividends`·`get_rebalance`·`get_exposure` 전부 `_usdkrw_rate()` 경유
- `services/digest_service.py` — 일일 텔레그램 다이제스트
- (+ `routers/recommendations.py`)

도달: 일주일간 아무도 시장지표 탭을 안 열면 포트폴리오 KRW 환산 총액·리밸런싱 비중·익스포저·배당 추정·일일 다이제스트가 전부 **일주일 된 환율**로 계산되고, 응답 어디에도 stale 마커가 없다. `_usdkrw_rate` 자체는 잘 짜여 있다(`math.isfinite` 가드 보유) — 결함은 순수하게 신선도다.

부수(§12.5): 그 함수의 docstring이 **존재하지 않는 배치를 단언했다** — *"FX 배치(get_fx)가 채운 영구 캐시를 읽는다."* → 해소(2026-08): 작성자 둘(배치 `fx_fetch` / 요청경로 `get_fx`)을 구별해 다시 썼다.

### 6.5 FX 저장 payload가 `usdkrw` history만 담는다 — **잠재 위험** (B25)

`fx.py::get_fx`:

```python
history = {"usdkrw": results["usdkrw"]["history"]} if results.get("usdkrw") else {}
```

`usdjpy`/`eurusd`의 history는 **한 번도 저장되지 않는다**. 결과: (a) `_fetch_fx`가 그 두 키에 대해 항상 `stored_history=[]`로 호출돼 **매 실행 1년치를 전량 재조회**하고, (b) `_fetch_fx` 안의 `stored_history` 기반 폴백 경로가 그 둘에겐 **원리적으로 발동 불가**하다. `rates` 수준 폴백(`failed` 리스트 ← `stored_rates`)은 정상 동작하므로 값이 사라지지는 않는다 — 비용과 죽은 폴백 경로가 문제다.

### 6.6 기동이 이벤트 루프를 블록한다 — **잠재 위험**

`main.py::lifespan`은 `_migrate()` → `sched.start()`를 **동기로** 부르고, `scheduler/__init__.py::start`는 `_scheduler.start()` **이전에** 다음을 순차 실행한다:

```python
_check_missed_report()      # 누락 티커마다 generate_report_with_retry (라이브 yfinance/Naver/KIS/DART)
_seed_rankings_if_empty()   # KR·US 라이브 Naver 랭킹 fetch
_seed_kr_sector_if_empty()  # 라이브 키움
_seed_us_sector_if_empty()  # 라이브 yfinance
_scheduler.start()
```

전부 이벤트 루프 스레드에서 돈다 → 그동안 `/health`가 응답하지 못한다. `deploy.sh`의 배포 후 `curl -s http://localhost/health`(고정 `sleep 2` 뒤)는 리포트 백필이 밀려 있는 배포마다 **"WARNING: health check failed"**를 찍지만, 그 curl이 `|| echo`라 배포는 그대로 완료로 보고된다(§10.5).

⚠️ **원인 귀속 주의**: CLAUDE.md에 기록된 "배포 후 API 5분+ 무응답"의 정확한 메커니즘은 **미확정**으로 남아 있다(lifespan 자체는 0.6초로 실측됐고 배치는 스케줄러 스레드다). 위 `sched.start()` 블로킹은 **코드로 확인된 별개 경로**이며, 그 5분 현상의 확정 원인이라고 단정하지 말 것.

### 6.7 잡 타임아웃·중복·종료 — **잠재 위험**

- **중복 실행은 불가능하나 스킵이 안 보인다**: `schedule.py`가 `coalesce=True, replace_existing=True`를 주고 `max_instances`를 생략해 APScheduler 기본 `max_instances=1`이 적용된다. 초과 실행은 *거부*되는데 APScheduler 내부 WARNING만 남고 **`job_runs` 행이 아예 안 생긴다** — 운영자는 직전 success만 보고 다음 발화가 드롭된 증거를 못 본다.
- **잡 타임아웃 없음**: `_investor_trend_work`·`_short_sell_work`가 `ThreadPoolExecutor(max_workers=8)`의 `future.result()`를 **`timeout=` 없이** 부른다. §2.5(yfinance 무타임아웃)와 겹치면 멈춘 HTTP 하나가 잡 전체를 무기한 잡는다. `AsyncIOScheduler`가 sync 잡을 `run_in_executor(None, …)`로 던지므로 기본 스레드풀을 점유한다.
- **종료**: `_scheduler.shutdown(wait=False)`. 진행 중 배치가 쓰기 도중 버려지고, `deploy.sh`의 `docker stop`(SIGTERM 10s)과 겹치면 `job_runs`에 **영구 `running` 행**이 남는다(`_finish`가 영영 안 돈다).
- **다중 스케줄러**: uvicorn 워커에서 오는 위험은 없다(`Dockerfile` CMD에 `--workers` 없음, compose에도 `command` 없음 → 단일 프로세스). 진짜 위험은 **컨테이너 이름 충돌**이다 — §10.3.

### 6.8 KST vs 컨테이너 UTC — **부분 가드** (B7·B8·B42 해소, task#330)

`services/utils.py::today_kst`(달력일)·`::now_kst`(타임스탬프)가 하우스 규칙이고 `tests/test_no_bare_today.py`가 강제한다. 하지만 그 가드는 AST에서 **`node.func.attr == "today"`만** 매칭하므로 **`datetime.now()`/`utcnow()`는 못 잡는다** → `tests/test_kst_date_boundaries.py::test_owned_modules_have_no_naive_now_or_utcnow`가 그 둘을 담당한다. ⚠️ 그 축은 **열거된 파일만** 훑는다(현재 6파일: `dividends.py`·`consensus_pipeline.py`·`disclosures.py`·`insider_trades.py`·`routers/guru.py`·`scheduler/jobs.py`) — 새 타임스탬프·날짜 writer를 만들면 그 목록에 추가해야 감사가 성립한다.

**해소된 것** (전부 `today_kst`/`now_kst` 또는 `ZoneInfo` 명시로 교체, task#330):

- ~~**B42 `services/insider_trades.py::fetch_insider_trades`**~~ (MED) — `bgn_de`/`end_de`를 `datetime.now()`로 만들어, KST 스케줄인 `insider_fetch`가 00:00–09:00 KST에 UTC 전일을 보고 `end_de`가 **당일 DART 공시를 통째로 배제**했다.
- ~~**B42 `services/disclosures.py::fetch_disclosures`**~~ (MED) — `bgn_de` 시작점 동일 드리프트. 공시 피드와 AGM `meeting_date` 추출의 DART `list.json` 범위를 먹였다.
- ~~**B7 `services/dividends.py::_recent_business_year`**~~ (MED) — `now = datetime.now()` → `year - (2 if now.month < 4 else 1)`. **월 경계 판정**이라 4월 1일 00:00–09:00 KST(UTC 3월 31일)엔 `month==3`이 되어 `year-2`를 반환, 그 창의 모든 KR 배당이 틀린 사업연도로 조회됐다. 아이러니하게 같은 파일이 올바른 `_today_kst()`를 따로 정의하고 있었다(그 중복 몸통은 정본 헬퍼로 접었다).
- ~~**B8 `services/consensus_pipeline.py`**~~ (LOW) — 컨센서스 `report_date`. 실측된 결함은 tz-aware 변환이 아니라 **naive UTC 인덱스를 미 시장일로 착각해 `.date`를 취한 것**이었다(yfinance `upgrades_downgrades` 인덱스는 항상 naive UTC라 `if idx.tz is not None` 분기는 dormant다) — 미 동부 20:00 이후 액션이 하루 앞선 날짜로 저장됐다.
- ~~**LOW(사용자 노출): `scheduler/jobs.py::_run_guru_crawl`·`routers/guru.py::_run_crawl`**~~ — `datetime.now().isoformat()`으로 쓴 명부 `last_updated`가 naive UTC라 `GuruCrawlNow.jsx`가 크롤 시각을 **9시간 과거로** 표시했다(00~09시 KST엔 날짜까지 하루 뒤). `now_kst()`로 교체 — **두 레인 쌍**이라 한쪽만 고치면 값이 레인마다 엇갈린다.

**잔존** — LOW: `backlog.py`·`market/kr.py`의 `utcnow() - timedelta(days=730)`은 2년 룩백이라 하루 시프트가 무의미. `backlog.py::_get_corp_code_map`의 `utcnow()`는 *상대* TTL 비교라 올바름. `routers/analyst_reports.py`·`services/kis/futures.py`·`services/report_generator.py`·`market_indicators/kospi_signal.py` 4곳은 `_KST = ZoneInfo(...)`를 **자체 재구현**한 상태다(동작은 맞지만 정본 헬퍼를 안 쓴다 — 그 형태가 정확히 B7을 만든 토양이다).

### 6.9 배치 레지스트리 정합 — **이미 가드됨 + 테스트 취약**

`batch_registry.BATCHES`는 33개, `_JOB_FUNCS`는 32개로 **의도적으로 하나 어긋나 있다**(`consensus`가 레지스트리에만 있다 — 실측 차집합이 정확히 `{consensus}`이고 `_JOB_FUNCS`에만 있는 id는 0개다). 이 둘을 순진하게 동기화하려는 수정은 실패한다. 테스트 쪽 취약성은 §9.4.

---

## 7. 프론트엔드

### 7.1 access token 갱신 경로가 없다 — **확인된 버그** (B9)

`frontend/src/api.js`의 응답 인터셉터가 전부다:

```js
if (err.response?.status === 401) {
  localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token')
  window.location.replace('/')
}
```

`refresh_token`은 **4곳에서 쓰이고 정확히 1곳에서 읽힌다** — `App.jsx`가 `/api/auth/logout`에 POST할 때뿐. `/api/auth/refresh` 호출은 **프론트 전체에 0건**인데 **백엔드 엔드포인트는 존재한다**(`routers/auth.py::refresh`). 즉 회전·만료가 제대로 구현된 서버측 리프레시가 통째로 미사용이고, 30일 refresh token은 `localStorage`에 순수 공격 표면으로 앉아 있다.

**부작용이 더 아프다**: 이 401 핸들러는 **전역 하드 내비게이션**이라 백그라운드 폴러에도 발동한다 — `usePortfolioData`(KR 장중 15초마다 `/api/portfolio/prices`)·`useReportGeneration`(1.5초마다 `/api/report/progress`). 도달: `StockModal`을 반쯤 채운 상태에서 토큰이 만료 → 폴러가 401 → **입력 중에 로그인 화면으로 순간이동**, 만료 안내 토스트도 복귀 경로도 없다(`location.replace`가 딥링크를 의도적으로 버린다).

### 7.2 에러 바운더리가 없다 — **확인된 버그** (B48)

`grep -rn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" frontend/src/` → **0건**. 렌더 중 throw가 루트까지 전파되면 React 19가 트리 전체를 언마운트하고 `#root`가 비며, 내비게이션도 새로고침 유도도 없다(`useSwUpdateReload`도 함께 언마운트된다). `index.html`의 테마 부팅 CSS 때문에 사용자는 단색 사각형을 본다.

이 부재가 아래 크래시 사이트들을 전부 **백지**로 증폭한다:

| 심각도 | 파일 · 심볼 | 던지는 조건 |
|---|---|---|
| HIGH | `pages/GuruDetail.jsx::GuruDetail` — `splitManagerName(manager.name)` | `setManager(data)`가 null/빈 200 본문을 받으면 `loading=false`·`error=null`로 통과해 `manager.name` 접근 |
| HIGH | `pages/AnalystReport.jsx::AnalystReport` — `report.data \|\| {}` | `setReport(data)`에 null 가드 없음 |
| HIGH | `pages/Calendar.jsx` → `MonthGrid` — `setEvents(r.data.events)` 후 `for (const e of events)` | `events` 키 없는 응답 → not iterable |
| HIGH | `pages/Analytics.jsx::CorrelationHeatmap` — `!data.tickers.length`, `matrix.map(row => row.map(...))` | `tickers` 없는 200, 또는 비정형 matrix |
| MED | `pages/GuruManagers.jsx::GuruManagers` — `data.managers.filter(...)` | `setData(data)`가 기본값을 통째 교체(형제 `GuruHoldersSection`은 `data.managers \|\| []`로 올바름) |
| MED | `pages/GuruStats.jsx::StatRow` — `row.score.toFixed(3)` | 같은 파일의 다른 필드는 전부 `?? '-'`인데 여기만 무가드 |
| MED | `pages/Settings.jsx::BatchHub` — `batches.filter(...)` | `batches.length === 0` 검사가 객체에선 false라 `.filter`까지 도달 |

### 7.3 비동기 레이스 — **일부 가드됨, 6곳 미가드**(task#331에서 5곳 닫힘)

**참조 구현(그대로 둘 것)** — 세대 카운터를 `.then`·`.catch`·**`.finally`까지** 검사하는 올바른 형태:

- `pages/Ranking.jsx::fetchPage` — `genRef`를 세 핸들러 전부에서 비교하고, `if (!reset && loadingRef.current) return` 뮤텍스는 무한스크롤 재진입에만 걸며 `reset`이 뮤텍스를 우회해 세대를 올린다. **B27은 여기서 닫혔다.**
- `hooks/useTrackedStocks.js::reload` — `reloadGenRef` 3핸들러 검사.
- `pages/GuruAllocation.jsx` 스코프 이펙트 · `Compare.jsx` · `Recommendations.jsx` 마운트 이펙트 · `components/market/*Section.jsx` — `cancelled` 플래그 + cleanup.

**미가드(확인)**:

| 심각도 | 파일 · 심볼 | 증상 |
|---|---|---|
| ~~HIGH (B49)~~ | ~~`pages/Reports.jsx` 상세 fetch 이펙트~~ | **닫힘(task#331)** — 취소 플래그 3핸들러 + `.catch`(실패는 `report-detail-error` 배너로 표시). 회귀 축 `frontend/src/test/report-detail-stale.test.jsx` |
| ~~MED~~ | ~~`pages/AnalystReport.jsx` 발행물·이력 이펙트~~ | **닫힘(task#331)** — `ReportDetailTabs.jsx`가 `key` 없이 렌더하고 「이전 판」이 부모 `deepDate`만 갈아끼우므로 **같은 마운트 내** 레이스였다(형제 `ConsensusSection`은 이미 가드돼 있었다). 이력 이펙트의 `filter(d => d !== date)`는 낡은 클로저의 `date`를 쓰므로 가드 없이는 **지금 보고 있는 판이 「이전 판」 목록에 남는다** |
| ~~MED~~ | ~~`components/reports/ConsensusChart.jsx::fetchData`~~ | **닫힘(task#331)** — 세대 가드 3핸들러(낡은 세대의 실패는 auto-retry도 예약하지 않는다 — 그 재시도가 옛 종목을 다시 부른다) + 티커 전환 시 `null` 리셋 |
| ~~MED~~ | ~~`components/reports/DetailTab.jsx::BacklogSection`~~ | **닫힘(task#331)** — `cancelled` 플래그 + 조회 전 `null` 리셋 |
| HIGH | `pages/Ranking.jsx::onRowClick` | 세대 카운터 없음. (a) 모달을 닫아도 나중 착지한 응답이 **닫은 모달을 다시 연다**, (b) A→B 연속 클릭 시 B 모달 안에 A 리포트. 60줄 위에 올바른 패턴이 있는데 여기 적용만 빠졌다 |
| HIGH | `pages/Calendar.jsx` 월 이펙트 | `›`를 두 번 빠르게 → 헤더는 새 달, 셀은 옛 달의 실적·배당일 |
| MED | `pages/Recommendations.jsx::handleChip` | 마운트 이펙트엔 `cancelled` 가드가 있는데 칩 토글 재fetch엔 없다 |
| MED | `components/StockSearchBox.jsx` 검색 이펙트 | 디바운스(350ms)는 레이스 가드가 아니다 — 느린 1차 응답이 나중 착지해 `삼성전자` 텍스트 아래 `삼성` 결과가 뜨고, 행을 고르면 **틀린 티커**가 관심종목에 들어간다 |
| ~~MED~~ | ~~`components/reports/HistoryTab.jsx` 3이펙트~~ | **닫힘(task#331)** — `cancelled` 플래그, 히스토리 이펙트는 `.finally`까지 게이트. ⚠️ `.finally` 게이트의 회귀 축은 **새 요청을 in-flight로 붙잡은 채** 낡은 응답을 착지시켜야 이빨이 생긴다 — 새 요청을 먼저 해소하는 픽스처는 두 `.finally`가 같은 값을 써서 관측 차이가 원리적으로 생기지 않는다(주입 실측: 그 순서에서는 `.finally` 게이트를 지워도 8축 전부 초록) |
| MED | `hooks/usePortfolioData.js::fetchAll`/`fetchDashboard` | 5개 호출 지점(마운트·bounded heal 루프·탭 클릭 2곳·↺ 버튼)이 경쟁하고 `finally`가 무조건 스피너를 끈다 |
| MED | `hooks/useReportList.js::fetchList` | 가드도 `.catch`도 없다 |

### 7.4 삼켜진 fetch가 "데이터 없음"으로 위장한다 — **확인된 버그**

**`.catch`가 아예 없는 곳**(미처리 rejection + 오류를 빈 상태로 렌더):

- **HIGH `pages/GuruManagers.jsx`** — `api.get('/api/guru/managers').then(...).finally(...)`. 실패 시 `데이터 없음 — 설정 > 구루 탭의 "즉시 크롤링"에서 데이터를 가져오세요.`가 뜬다. **fetch 실패가 사용자에게 크롤을 실행하라고 지시한다.** 형제 `GuruStats.jsx`·`GuruAllocation.jsx`는 둘 다 *"실패를 '크롤링을 먼저'로 위장하지 않는다"* 주석과 함께 올바르게 처리한다 — 이 파일만 놓쳤다.
- **HIGH `hooks/useReportList.js::fetchList`** — 실패 시 `reportList`가 `{}`로 남아 `리포트가 없습니다. 설정 페이지에서 '지금 생성' 버튼을…`이 뜬다. **앱의 주 화면이 백엔드 blip을 "리포트가 없다"로 표시한다.**
- **HIGH `hooks/useReportGeneration.js::_startPoll`** — 1.5초 `setInterval` 안의 bare `catch {}`. `/api/report/progress`가 계속 실패하면 인터벌이 영원히 안 걷히고 `generating`이 non-null로 남아 **진행률이 얼어붙은 "생성 중"**이 지속된다. 탈출은 언마운트뿐.
- MED: `pages/Reports.jsx`의 `?scope=all`(admin '그외' 탭 공백), `components/PermissionManager.jsx`(권한 관리 화면에 빈 사용자 표).

**삼키는 `.catch`**(오류와 "없음"이 구별 불가): `Ranking.jsx`의 리포트 모달 `.catch(() => {})`(500이 "아직 리포트 없음"으로 보여 사용자가 이미 있는 종목을 또 추가한다)·뉴스 `.catch(() => setNews([]))`, `StockSearchBox`의 `.catch(() => setResults([]))`. 의도적이고 문서화된 것: `ReportDetailTabs`·`DetailTab`(backlog)·`SupplySection`·`GuruHoldersSection`(`// eco: silent`)·`utils/analytics.js`·`utils/pwa.js`·`App.jsx` 로그아웃 비콘·`Calendar.jsx` 인접월 프리페치.

**MED `contexts/AuthContext.jsx`** — `/api/auth/me` 실패 시 `.catch(() => { setRole('user'); setMenuPermissions([]) })`. 재시도도 사용자 피드백도 없어 **admin이 blip 한 번에 일반 사용자로 조용히 강등**되고, admin 버튼·'그외' 탭·권한 화면이 사라진 것이 실제 권한 변경과 구별되지 않는다.

### 7.5 `authLoading` 데드엔드 — **잠재 위험**

`hooks/useAuthBootstrap.js`의 OAuth 분기가 쓰는 bare `fetch`에 **`AbortSignal`도 타임아웃도 없다**(`api.js`에도 axios `timeout` 설정이 없어 기본 0=무한). 모든 *정착* 경로는 `resolveStored()`로 `authLoading`을 내리므로 rejection은 덮여 있다 — 그러나 **영영 정착하지 않는 연결**(캡티브 포털, 조용히 끊긴 TCP)은 `authLoading=true`에 머물고 `App.jsx`가 스플래시를 무한 렌더한다. 수동 새로고침 외 탈출 없음. 같은 파일의 주석이 형제 실패 모드("새로고침 전까지 빠져나올 수 없는 백지")를 이미 문서화하고 있는데, **이것이 그 미덮인 변종**이다.

### 7.6 Service Worker가 `/api/*`를 가로챈다 — **닫혔다**(구 B47) + 설계 잔여

`vite.config.js`의 VitePWA `runtimeCaching`에서 `/api/*` 항목이 **통째로 제거**됐다(task#290 S4, ADR-0036) — 남는 `runtimeCaching`은 `google-fonts`·`cdn-fonts` 2건뿐이고 인증된 API 응답은 더는 캐시되지 않는다. 이미 기기에 남아있는 `api-cache` 저장소는 **삭제 지점 2곳**이 정리한다: 부팅 1회(`frontend/src/main.jsx`)와 `App.jsx::doLogout` — 둘 다 `apiCachePurge.js::purgeApiCache`(`caches.delete('api-cache')`)를 부른다.

- **닫힘(구 B47) — `api-cache`가 사용자별로 분리되지 않고 로그아웃에도 안 지워지는 문제.** 캐싱 자체가 없어졌으므로 교차사용자 데이터 서빙 경로가 사라졌다.
- ⚠️ **단, "닫혔다"는 새 SW가 활성화된 뒤의 이야기다.** 옛 SW가 아직 살아 있는 전환 창에서는 옛 SW가 계속 캐시하므로 위 삭제 2지점이 그 창의 방어선이다. `doLogout`이 SPA 전용(리로드 없음)이라 부팅 퍼지만으로는 **B47의 주 도달 경로("A 로그아웃 → 5분 내 같은 브라우저에서 B 로그인")가 같은 문서 안에서 일어나 안 덮인다** — 그래서 `doLogout`에도 퍼지를 넣었다(ADR-0036 결정절 보정). 그 창에 남는 잔여는 **로그아웃을 거치지 않는 계정 전환** 하나이고, 근본 처방은 삭제 지점 추가가 아니라 **SW 활성화를 앞당기는 것**이다(`injectRegister: 'auto'`가 만드는 `registerSW.js`가 등록을 `window.load`에 게이팅한다 — ADR-0036 후속 후보, 창 길이 미측정).
- **함께 닫힘 — 무표시 stale 금융 데이터(MED).** 10초 `networkTimeoutSeconds` 폴백이 최대 5분 된 캐시를 "방금"으로 보이게 하던 경로도 캐싱 제거로 동시에 사라졌다(`PriceFreshness`가 읽는 `lastUpdated` 자체의 계산 방식은 무변경 — 캐시가 없으니 그 오차가 발동할 입력이 없다).
- **앱 셸 stale 위험은 없다(확인, 무변경)** — `globPatterns`가 `.html`을 제외하고 `navigateFallback: null`, 프리캐시 목록에 `index.html`이 없다. 내비게이션은 항상 네트워크를 탄다.
- ⚠️ **다시 넣지 말 것** — API 캐싱을 되살리려면 캐시 키에 신원이 들어가야 한다(ADR-0036이 기각한 대안 2). 그 배선 없이 규칙만 되돌리면 이 항목이 그대로 재발한다.
- **업데이트 리로드 루프는 유계**(`hadControllerRef`가 최초 설치를 억제, `attemptReload`가 `pendingRef`를 리로드 *전에* 내린다). LOW 잔여: `isBusy()`가 `document.body.style.overflow === 'hidden'`을 바쁜 것으로 보므로, 어떤 경로가 스크롤 락을 남기면 탭이 옛 번들에 **무기한 고정**된다(폴백 타이머 없음).

### 7.7 동일 엔드포인트 다중 소비처 — **잠재 위험**(이미 드리프트 발생)

| 엔드포인트 | 소비처 | 실제 드리프트 |
|---|---|---|
| `/api/guru/managers` | `GuruManagers.jsx`·`GuruHoldersSection.jsx`·`Recommendations.jsx`·`GuruCrawlNow.jsx` | **있음** — `setData(data)`(무가드) vs `data.managers \|\| []` vs `guru.data?.managers` vs `.catch(() => ({data:{managers:[]}}))`. 한 엔드포인트에 **4개의 서로 다른 형태 계약** |
| `/api/stocks/dashboard` | `usePortfolioData.js`·`Analytics.jsx` | **있음** — `res.data?.holdings \|\| []`(객체 전용) vs `r.data?.holdings ?? r.data ?? []`(객체 *또는* 배열). 둘 중 하나는 계약을 잘못 알고 있다 |
| `/api/report/{ticker}/history` | `HistoryTab.jsx`·`useStockManagement.js`·`Ranking.jsx` | **있음** — `data.filter(...)`(무가드) vs `(data \|\| []).filter(...)` |
| `/api/report/list` | `useReportList.js`·`Reports.jsx`·`ReportManualGen.jsx`·`useReportGeneration.js` | `data.stocks ?? data` 이중 형태가 4곳 중 2곳에만 |
| `/api/stocks` | `useTrackedStocks.js`·`GlobalSearch.jsx`·`TechReport.jsx`·`AnalystReports.jsx` | `ticker→type` 맵 빌드가 3곳에서 독립 재구현(2곳은 바이트 동일) |
| `/api/market/fx` | `usePortfolioData.js`·`Analytics.jsx`·`FxSection.jsx` | `data?.rates?.usdkrw?.current` 경로 + 하드코딩 폴백값이 2곳에 복제 |
| `/api/consensus/{ticker}` | `ConsensusChart.jsx`·`AnalystReport.jsx` | `AnalystReport`는 `Array.isArray(data)` 가드, `ConsensusChart`는 없음 |

`components/reports/LatestDisclosuresSection.jsx`의 `Array.isArray(data) ? data : []`가 **저장소에서 유일하게 올바른 형태**다.

### 7.8 죽은 코드 — **잠재 위험**(낮음)

- **`components/Glossary.jsx` + `glossary/terms.js` + `glossary/match.js` + `Glossary.css`** — importer 0건. `terms.js`/`match.js`는 `Glossary.jsx`만 import하고 `Glossary.jsx`는 아무도 import하지 않는다. 용어집 기능 전체가 도달 불가이며, `glossary/match.test.js`가 초록을 유지해 생존했다.
- **`hooks/useAuth.js`** — `export { useAuth } from '../contexts/AuthContext'` 한 줄. 9개 소비처가 전부 `contexts/AuthContext`를 직접 import한다. importer 0건.
- **`hooks/usePortfolioData.js`가 만들고 아무도 안 읽는 값 3개** — `dashboardError`·`events7d`·`refreshLivePrices`. 3개 소비처(`Portfolio.jsx`·`Reports.jsx`·`Compare.jsx`) 중 어느 것도 구조분해하지 않는다. 특히 `events7d`는 **세 페이지 마운트마다 `GET /api/digest/latest`를 비용으로 치르고 결과를 버린다**. `dashboardError`가 안 읽히는 탓에 `Portfolio.jsx`는 재시도 *횟수*로 실패를 추정해, 진짜 0-보유 응답과 하드 실패가 같은 카드로 렌더된다.
- `hooks/useSwUpdateReload.js`의 `if (window.location.search.includes('oauth=')) return true` — 파일 자신의 주석이 현 배선에서 도달 불가임을 명시.

### 7.9 중복 렌더러 — **잠재 위험**(이미 드리프트)

- **`pages/GuruManagers.jsx`** 모바일 블록 vs 데스크톱 블록 — 정규화 64줄 중 **60줄 동일**. 이미 갈라졌다: 데스크톱 배지 툴팁만 `'\n[클릭하여 관심종목 추가]'`를 덧붙여 **같은 컨트롤이 뷰포트마다 다른 어포던스를 광고한다**.
- **`buildGuruCounts`** — `pages/GuruManagers.jsx`와 `pages/Recommendations.jsx`에 바이트 동일 정의(후자에 "앞의 것과 같다"는 주석까지 있다).
- `pages/Portfolio.jsx` 모바일/데스크톱이 5버튼 `analysisTab` 바를 그대로 복제.

`components/reports/StockActions.jsx`는 반대 사례다 — 과거 두 렌더러의 중복이었던 액션 버튼을 단일 컴포넌트로 통합했다.

### 7.10 접근성 — **일부 확인, `role="img"`는 클린**

**`role="img"` 2개 사이트는 전부 올바르다 — 고치지 말 것**: `components/sketches/*.jsx`(장식 라인아트 + `<title>`), `components/tech/TechLevelBand.jsx`(빈 장식 `<span>` 격자, 데이터는 `aria-label`과 형제 노드가 운반 — 자손 프루닝이 의도). ⚠️ **세 번째였던 `components/tech/TechGraph.jsx`는 목록에서 빠졌다(task#317)** — SVG를 세로 흐름 HTML로 재작성해 `aria-hidden` svg와 그것을 보상하던 `<ul className="sr-only">` 이중 목록이 **둘 다 사라졌다**. 칩이 진짜 DOM 텍스트이므로 재노출이 필요 없고, 남겨두면 스크린리더가 같은 이름을 두 번 읽는다.

**MED — DOM에 없는 접기 3곳**(Ctrl+F·스크린리더 브라우즈·인쇄가 놓친다): `pages/GuruDetail.jsx`의 `expanded ? listRows : listRows.slice(0, DEFAULT_ROWS)`(21번째 이후 보유종목이 DOM에 없음), `pages/Recommendations.jsx::ExpandableGrid`의 `items.slice(0, count)`, `pages/AnalystReport.jsx::ConsensusSection`의 `brokerages.slice(0, 10)`. 저장소는 이미 반대로 판정한 바 있다 — `components/tech/ProseSections.jsx`의 주석: *"접기는 네이티브 `<details>`/`<summary>`다 — JS 상태 0, 키보드·스크린리더·Ctrl+F 검색이 전부 공짜"*.

**MED — 복구 수단 없는 한국어 절단**: `overflow:hidden; textOverflow:ellipsis; whiteSpace:nowrap`을 한국어 종목명에 걸면서 **`title` 속성이 없어** 전체 문자열에 어떤 경로로도 닿을 수 없다 — `pages/GuruDetail.jsx`(보유 행·전량매도 칩), `pages/Ranking.jsx` 데스크톱 분기(모바일 분기는 `WebkitLineClamp: 2`로 올바르다), `components/StockSearchBox.jsx`(이름이 유사 티커 간 주 판별자인 자리). `pages/GuruAllocation.jsx`가 올바른 대조군이다(수치를 별도 `<span>`으로 분리).

**MED — `guru-badge`가 클릭 전용이고 `role="button"` 안에 중첩**: `pages/GuruManagers.jsx`의 `<span onClick={…}>`에 `role`·`tabIndex`·`onKeyDown`이 없어 키보드·스위치 사용자가 토글할 수 없고, 그 span이 카드 `<div role="button" tabIndex={0}>` 안에 있어 인터랙티브 중첩이다. `GuruStats.jsx::WatchlistBtn`이 저장소 표준(진짜 `<button>`)이며 이 두 블록만 이례다.

### 7.11 거대 컴포넌트 — **잠재 위험**(낮음)

`components/reports/DetailTab.jsx`(701줄)·`pages/AnalystReport.jsx`(570)·`pages/Ranking.jsx`(563)·`components/reports/Sections.jsx`(516)·`ConsensusChart.jsx`(476)·`FinancialsChart.jsx`(434). ⚠️ 이 수치는 **길이 서술**이라 규정된 감사 grep(`파일명:NNN` 포인터)이 원리적으로 못 본다 — 줄 수를 바꾸는 변경에서 함께 갱신할 것(task#331에서 5개가 드리프트했다).

---

## 8. 캐시·무효화

### 8.1 인메모리 캐시 6종 — **가드됨** (B69 해소, task#330)

`services/cache.py`: snapshot(LRU 200)·list(TTL 5s)·dashboard(300s)·correlation(300s)·sector(300s)·macro(300s). 종목 추가·수정·삭제 시 dashboard·correlation·sector·macro가 자동 무효화된다.

3사이클 이월 뒤 task#325가 `threading.Barrier` 하니스로 재현하고 task#330이 닫았다. **락 규율 4항**(`TTLCache` docstring이 정본):

1. `_lock`은 **dict 조작 구간만** 감싼다 — `loader()`는 락 **밖**에서 돈다(`_dashboard_cache`의 loader는 카드당 10-워커 ThreadPool을 쓰는 수 초짜리 작업이라 락 안에 넣으면 다른 사용자의 조회와 `invalidate()`가 그만큼 막힌다).
2. 그 대가로 loader 실행 중 들어온 `invalidate()`를 **세대 카운터**(`_gen` / 모듈 전역 `_snap_gen`)로 감지해 캐시 적재를 건너뛴다 — 무효화가 조용히 no-op이 되는 것은 stale 값을 되살리는 정합 결함이다. 세대는 캐시 단위라 다른 키의 무효화도 in-flight 적재를 취소한다(보수적인 쪽).
3. 만료 정리는 **in-place 삭제**다. 옛 구현은 `self._store = {...}`로 dict를 **재바인딩**해, 그 창의 `invalidate(key)`가 버려질 dict에 적용돼 유실됐다.
4. 이 락은 **다른 락을 잡은 채로 획득하지 않는다**(중첩 0 → 데드락 불가). `cache.invalidate(ticker)`도 `_snap_lock`을 놓은 뒤 파생 캐시를 무효화한다.

⚠️ **축은 두 캐시에 각각 둘 것.** 같은 규율을 `TTLCache`와 모듈 전역 `_snapshots` 양쪽에 넣었는데 초기엔 회귀 축이 `TTLCache`에만 있어 `_snap_gen` 가드가 **전 스위트에서 이빨 0**이었다(`if True:`로 무력화해도 실패 0 — 적대 검토가 잡았다). 현재는 `tests/test_concurrency_locks.py`에 `test_ttlcache_invalidate_during_loader_is_not_lost`와 `test_get_snapshot_invalidate_during_loader_is_not_lost`가 쌍으로 있다.

### 8.2 `market_cache` 신선도 — §6.3·§6.4 참조

키별 경계와 `fx`의 무배치 문제는 배치 절에 모았다(작성자가 스케줄러이므로).

### 8.3 캐시 무효화 대칭성 — **이미 가드됨**

캘린더는 종목 추가·삭제·승격 시 `invalidate_portfolio_caches(user_id)` → `calendar.clear_cache(user_id)`로 DB 행까지 지운다(과거 파일만 지워 DB가 stale이던 문제는 닫혔다).

---

## 9. 테스트·검증 게이트의 사각

**규모**: 백엔드 테스트 141개 파일, 프론트 63개.

### 9.1 실 DB 차단 — **이미 가드됨(잔여만)**

`tests/conftest.py`의 autouse `_block_real_db`가 `db_svc._get_pool`을 raise로 교체한다. 기원은 주석에 있다 — 라이브 DB `generate_report` 테스트가 실 `005930` 스냅샷을 덮은 사고.

**잔여(LOW-MED)**: 가드가 **DSN이 아니라 초크포인트를 막는다**. `backend/run_backfill.py`의 `psycopg2.connect(DB_DSN)`은 `_get_pool`을 거치지 않아 원리적으로 우회다(현재 그 경로를 부르는 테스트는 없다). 또 테스트가 autouse 이후 `_get_pool`을 되돌리는 것을 막는 장치는 없다. 완화: `pytest.ini`의 `testpaths = tests`가 `backend/scripts/`·`run_backfill.py` 수집을 막는다.

**파일시스템·네트워크는 클린(확인)**: 파일을 쓰는 테스트는 전부 `tmp_path` + 대상 상수 patch를 쓴다(`test_digest_service.py`의 `patch.object(ds, "DIGEST_DIR", tmp_path)` 등) — **tracked 경로에 쓰는 테스트 0건**. `backend/tests/` 어느 파일도 최상위 `import requests`/`import yfinance`를 하지 않으며, mock이 전혀 없는 21개 파일은 전부 순수 함수·메타 테스트라 소켓을 열지 않는다.

### 9.2 recharts는 jsdom에서 SVG 자체가 없다 — **설계상 트레이드오프**

> `scripts/uat271-formatter.mjs`가 이 항목을 `CONCERNS §9.3`으로 인용한다 — 하위번호 유지.

`ResponsiveContainer`가 jsdom에서 0크기라 축·틱·마커·막대가 전혀 렌더되지 않는다. vitest에서는 범례 텍스트·캡션·데이터 유무 분기·표 부재만 단언 가능하고, 라벨 겹침·정렬 같은 시각 속성은 **라이브 Playwright의 `getBoundingClientRect()`**가 유일한 관측 수단이다.

### 9.3 존재하는 자동 게이트(재발 방지 자산)

| 게이트 | 무엇을 막나 |
|---|---|
| `tests/test_no_public_reads.py` | 무인증 라우트 신설·stale allowlist **양방향** + route walk가 0건이 되는 거짓 통과 |
| `tests/test_security_auth_gaps.py` | override 없는 fresh app으로 실제 401(API 키 positive/negative 포함) |
| `tests/test_api_doc_sync.py` | 라이브 `app.routes` ↔ `API_SPEC.md`/`CLAUDE_COWORK_API.md`의 엔드포인트 **존재** |
| `tests/test_no_print.py` | 앱 코드의 `print()` |
| `tests/test_no_bare_today.py` | bare `date.today()` (⚠️ `datetime.now()`는 못 잡는다 — §6.8) |
| `conftest._block_real_db` | 테스트의 prod DB 오염 |

### 9.4 정확한 개수 단언이 다음 배치 추가에서 깨진다 — **확인된 버그**(개발 마찰)

`batch_registry.BATCHES`에 **항목 하나를 더하면 4개 파일의 단언 8건이 동시에 깨진다**(2026-08-22 실측 — 옛 판은 "3파일 3건"이라 적었으나 지점 수가 틀렸다):

- `tests/test_batch_market_split.py` — **3지점**: `assert len(batch_registry.BATCHES) == 33` · `_MARKET_BY_ID`(id→market 완전 매핑 dict) · 시장별 개수 dict `{"KR": 16, "US": 11, "공통": 6}`
- `tests/test_batches_router.py` — **2지점**: `assert len(data) == 33` · `assert {b["id"] for b in data} == EXPECTED_IDS`(33원소 하드코딩 집합)
- `tests/test_macro_signals_batch.py` — **1지점**: `assert len(batch_registry.BATCHES) == 33`
- `tests/test_scheduler_seed.py` — **2지점**: `test_all_editable_jobs`의 `set(editable) == {…}` · `test_seed_only_fills_missing_rows`의 `expected_seeded` 집합

⚠️ **옛 판이 못박은 탐지 grep(`"BATCHES) ==\|len(data) ==\|EXPECTED_IDS"`)은 이 8지점 중 4개를 원리적으로 못 본다** — `set(…) ==` 형태와 dict 리터럴에 블라인드하다. 실제 게이트는 grep이 아니라 **전체 스위트**이고, grep은 "어느 파일을 볼지"만 좁힌다(`TESTING.md §5.6`).

그 라우터 테스트 함수 이름이 아직 `test_lists_sixteen_batches_with_required_fields`인 채 33을 단언한다 — 이름이 배치 17개만큼 뒤처져 있고, **이 함정이 이미 반복적으로 발동했다는 직접 증거**다. 주의: `EXPECTED_IDS`엔 `consensus`가 들어 있는데 이는 `_JOB_FUNCS`(32개)엔 없다(§6.9) — 둘을 순진하게 동기화하는 수정은 실패한다(실측 차집합이 정확히 `{consensus}`다).

### 9.5 게이트가 **못** 보는 것

- **레이아웃 수치·잘림·접힘·요소 간 간격·색 적용** — jsdom에 레이아웃이 없다. 라이브 프로브가 유일한 게이트다.
- **응답 스키마·인증 산문 드리프트** — `test_api_doc_sync.py`는 엔드포인트 *존재*만 본다.
- **줄번호 참조 드리프트** — 아무도 단언하지 않는다(§12.6).
- **판정축을 바꿔 통과하면서 거짓이 된 주석·docstring** — 스위트가 원리적으로 초록이다.
- **bfcache 복원** — Playwright 3엔진 전부 `pageshow.persisted`를 못 만든다(대조군으로 확정). chromium은 CDP로 물으면 `BackForwardCacheDisabledForDelegate`를 답한다 — 플래그 제거로 뚫리지 않는다.

### 9.6 admin 표면은 라이브 UAT가 원리적으로 불가 — **설계상 트레이드오프**

라이브 UAT 계정이 비admin이라 admin 화면·`require_admin` 엔드포인트를 Playwright로 열 수 없다. 대안 4축(게이트를 `require_admin_or_api_key`로 열기 / vitest+기능경로로 닫고 버튼 렌더는 이월 / admin 크레덴셜 수령 / **in-container 자체 호출**)을 착수 전에 골라야 한다.

### 9.7 프로브 자산 자체가 부채 — **잠재 위험**(낮음)

`scripts/`에 143개 항목이 쌓였고 루트에 `screenshots-uat*` 디렉터리가 90여 개 있다(전부 untracked). 어느 프로브가 현재 계약을 단언하고 어느 것이 스테일인지 구분하는 인덱스가 없다.

---

## 10. 배포·인프라·운영

### 10.1 두 개의 비동기화된 `git reset --hard origin/main` — **설계상 트레이드오프**(운영 위험 큼)

- `scripts/auto-deploy-poll.sh` — launchd 2분 주기
- `.github/workflows/deploy.yml` — self-hosted 러너

**둘 다 개발자의 라이브 작업 디렉터리에서 돈다**(이 감사가 도는 바로 그 경로). `/tmp/portfolion-deploy.lock`은 *동시 배포*는 막지만 작업트리를 보호하지 않는다 — 폴러는 lock 이후에 reset하는 반면 **Actions 워크플로우는 lock을 아예 확인하지 않고** `deploy.sh` 호출 전에 reset한다.

부수: 락이 PID도 staleness 검사도 없는 bare `/tmp` 파일이라 **크래시한 배포가 락을 남기면 이후 모든 배포가 영구 정지**한다(`deploy.sh`는 `exit 1`, 폴러는 `exit 0`).

### 10.2 컨테이너가 compose 밖에서 돈다 — **잠재 위험**

`deploy.sh`는 `docker compose`를 전혀 쓰지 않고 `portfolion-backend-1`·`portfolion-nginx-1`을 손으로 `docker run`한다 — **compose가 생성할 이름과 정확히 같다**(프로젝트 `portfolion` + 서비스 `backend`). 결과:

- **`postgres`는 `deploy.sh`가 기동·재기동하지 않는다** — 사전 `docker compose up`으로 이미 떠 있어야 한다.
- compose의 `depends_on: postgres: condition: service_healthy` 게이트가 **배포 경로에서 통째로 우회**된다(백엔드가 DB 없는 상태로 뜰 수 있다).
- 배포된 nginx가 compose의 **certbot 볼륨 마운트를 누락**한다. 현재는 `nginx/nginx.conf`의 `listen 443 ssl` 블록이 전부 주석이라 치명적이지 않으나, `location /.well-known/acme-challenge/ { root /var/www/certbot; }`는 **살아 있고 마운트 안 된 경로를 가리킨다** → deploy.sh가 띄운 nginx로는 ACME 갱신이 불가하다. 443 블록의 주석을 풀면 그 nginx는 아예 기동에 실패한다.
- 이후 누군가 `docker compose up -d`를 돌리면 자기가 만들지 않은 컨테이너를 보고 재생성하며, 손으로 띄운 컨테이너가 살아 있는 동안 그것을 돌리면 **같은 network-alias에 스케줄러 프로세스가 2개** 생길 수 있다(§6.7).

### 10.3 헬스체크·재시작 정책 — **잠재 위험**

- `docker-compose.yml`에 healthcheck가 있는 서비스는 **`postgres`뿐**(`pg_isready`).
- **`backend`엔 healthcheck가 없다** — compose에도 `deploy.sh`의 `docker run`에도. `--restart unless-stopped`는 *프로세스 종료*에만 반응하므로 **hang한 uvicorn은 영영 재시작되지 않는다**(§6.6·§6.7의 무타임아웃과 결합).
- **`certbot`엔 재시작 정책이 없다** — `while :; do certbot renew; sleep 12h; done` 루프가 호스트 재시작·컨테이너 크래시 시 영구 종료되고 인증서 갱신이 조용히 멈춘다.

### 10.4 배포 검증이 비차단이고 롤백이 없다 — **잠재 위험**

유일한 검증이 고정 `sleep 2` 뒤의 `curl -s http://localhost/health && echo " <- /health OK" || echo "WARNING: health check failed"`다 — **구조적으로 비차단**이다. 롤백 경로 없음. §6.6과 겹쳐 기동 백필이 있는 배포마다 이 경고가 뜨지만 배포는 성공으로 보고된다.

### 10.5 시크릿 폴백 — **확인된 버그** (B21) · B19은 해소

| 환경변수 | 파일 | 형태 |
|---|---|---|
| `POSTGRES_PASSWORD` | `docker-compose.yml` | `${POSTGRES_PASSWORD:-<리터럴 기본값>}` — 호스트 env가 없으면 tracked 파일에 박힌 약한 비밀번호로 조용히 뜬다 |
| ~~`SESSION_SECRET`~~ | `backend/routers/auth.py` | **해소**(task#326) — 모듈 레벨 리터럴 폴백을 `::_hmac_secret`의 호출 시점 해석 + `RuntimeError`로 교체 (§5.5) |

**남은 것은 `POSTGRES_PASSWORD` 하나**이고 저장소에 커밋돼 있다(B21 — task#334로 이월). 그 외 리터럴 시크릿 폴백은 없다. `backend/.env.docker`(실 시크릿 저장소)와 루트 `.env`는 올바르게 gitignored.

추가 노출: `docker-compose.yml`이 postgres를 `"5432:5432"`로 **호스트에 발행**한다. self-hosted 러너 머신에서 이는 호스트 인터페이스에 닿는 DB다.

### 10.6 볼륨 권한 — **잠재 위험**(낮음)

compose의 postgres 서비스가 `./backend/auth_schema.sql`·`./backend/app_schema.sql`을 **`:ro` 없이** `/docker-entrypoint-initdb.d/`에 마운트한다. 엔트리포인트는 읽기만 하지만 컨테이너가 tracked 소스 파일 2개에 쓰기 권한을 갖는다(그 파일들은 §10.1의 폴러가 `reset --hard`하는 대상이기도 하다). nginx 마운트는 compose·`deploy.sh` 양쪽에서 올바르게 `:ro`다.

부수(LOW): `deploy.sh`가 `TMP_DOCKER_CONFIG=$(mktemp -d)`를 만들고 지우지 않는다(`trap`은 락만 정리) — 배포마다 `/tmp` 디렉터리 누수.

### 10.7 의존성이 고정되지 않았다 — **잠재 위험**

`backend/requirements.txt` 18줄 전부 `>=` 또는 제약 없음(`python-dotenv`는 무제약), **락파일 없음**. `Dockerfile`이 `pip install -r requirements.txt`를 매 빌드 실행하고 `deploy.sh`가 매 배포 재빌드한다 → **같은 커밋의 두 배포가 서로 다른 `yfinance`·`pandas`·`fastapi`를 설치할 수 있다**. `yfinance>=0.2.40`은 `.info`/`.history` 형태 변경과 Yahoo 엔드포인트 이동 이력이 있는 라이브러리라, "어제는 됐는데" 클래스 장애의 가장 유력한 출처다.

프론트: `package.json`은 caret이지만 `package-lock.json`이 tracked다. 다만 `deploy.sh`가 `npm ci`가 아니라 **`npm install`**을 돌려 배포 중 락파일이 재작성될 수 있다.

### 10.8 로컬 `.venv`(3.9.6) ≠ Docker(3.12) — **설계상 트레이드오프**(사실상 하드 제약)

`backend/.venv/pyvenv.cfg`가 `version = 3.9.6`(macOS 시스템 파이썬), `backend/Dockerfile`이 `FROM python:3.12-slim`. **마이너 3개 차이**다. 코드는 3.10+ 문법(`str | None`)을 쓰면서 모듈마다 `from __future__ import annotations`로만 3.9에서 버틴다 — 그 import를 빠뜨리거나 어노테이션이 *런타임 평가*되는 자리(Pydantic 모델·FastAPI 시그니처)에 `X | Y`를 쓰면 컨테이너는 통과하고 로컬 pytest가 `TypeError`를 낸다. 로컬 pytest가 게이트이므로 실질적 하드 제약이다.

**`lxml`은 이미지엔 있고 로컬엔 없다** — `requirements.txt`에 `lxml>=4.9.0`이 있지만 `.venv`(228 패키지)에 없다. 코드는 이 괴리를 **손으로 견뎌 왔다**: 모든 `BeautifulSoup` 호출이 `"html.parser"`를 명시적으로 넘기고, `backlog_parser.py`가 `XMLParsedAsHTMLWarning`을 그 이유와 함께 억제한다. 즉 오늘의 일치는 **구조가 아니라 관례**다 — 누군가 두 번째 인자 없이 `BeautifulSoup(html)`을 쓰는 순간 컨테이너는 `lxml`, 로컬은 `html.parser`를 자동 선택해 파스 트리가 갈린다(특히 비정형 DART HTML에서).

**같은 패키지의 버전차도 형태를 바꾼다**: 배포 이미지의 FastAPI는 `include_router`로 들어온 라우트를 감싸 `.routes`를 평탄하게 노출하지 않을 수 있다. `app.routes`를 순회하는 코드는 로컬에서 100+개를 세고 컨테이너에서 0개를 셀 수 있다 — `tests/test_no_public_reads.py`가 이 실패 모드를 `len(api_routes) > 100` 단언으로 막고 있는 이유다(§5.1).

### 10.9 규모·복잡도 핫스팟

**백엔드 최대 파일**: `services/report_generator.py`(757)·`routers/stocks.py`(675)·`services/market/kr.py`(664)·`routers/report.py`(592)·`scheduler/jobs.py`(534)·`services/recommendation/funnel.py`(475)·`services/batch_registry.py`(473, 선언형 표)·`services/backlog.py`(438)·`services/consensus_pipeline.py`(424)·`services/guru_scraper.py`(421).

**150줄 초과 함수 2개**:
- **`report_generator.py::generate_report` — 322줄.** 동시에 (a) 최대 함수 (b) 가장 뜨거운 외부 I/O 경로 (c) §6.6에 따라 **기동 시 이벤트 루프에서 동기 실행**되는 함수다.
- **`routers/stocks.py::get_dashboard` — 173줄.** 단일 요청 경로 핸들러.

**프론트 최대 파일**은 §7.11. 백엔드 비테스트 19,287줄 / `frontend/src` 비테스트 19,709줄.

부수(LOW): `frontend/src/api.js`의 공유 axios 인스턴스가 `baseURL`만 설정하고 **`timeout`이 없다**(axios 기본 0=무한) — §6.6·§2.5의 hang이 UI를 무기한 스피너로 묶는다.

---

## 11. Cowork fire 파이프라인 (ADR-0028)

### 11.1 게이팅·SSRF — **이미 가드됨**

`POST /api/admin/cowork/fire`는 `require_admin_or_api_key`다. `services/cowork_trigger.py`는 **고정 env URL**(`COWORK_ROUTINE_FIRE_URL`)로만 POST하고 목적지가 사용자 입력을 받지 않는다 — **SSRF 없음**. `enabled()`가 `COWORK_ROUTINE_FIRE_URL`+`COWORK_ROUTINE_FIRE_TOKEN` 양쪽을 요구하는 both-required 게이트라 키 미설정 시 휴면이다.

### 11.2 best-effort 성격 — **설계상 트레이드오프**

fire 훅은 실패해도 본 요청을 막지 않는다(의도). 잔여는 §6.2와 같다 — 실패가 관측면에 안 나타난다.

---

## 12. 문서·설정 드리프트

### 12.1 부채 마커는 사실상 없다 — **관찰**

`TODO`/`FIXME`/`HACK` **0건**. 전 저장소(테스트 포함, `node_modules`·`.venv`·`dist` 제외)에서 10건이 걸리는데 그중 진짜 표시된 지름길은 **`components/PermissionManager.jsx` 1건뿐**("임시로 `selectedIds.length`를 `pendingPerms`에 붙인다")이고 나머지는 서술·환경 주석·`\uXXXX` 오탐이다.

**함의**: 이 저장소의 설계 의도는 마커가 아니라 **매우 긴 한국어 docstring**에 실린다. 따라서 실제 부채는 *주석되지 않은 구조적 부채*이며, 그것이 이 문서 §1~§11의 내용이다. 마커 grep으로 부채를 찾으려 하지 말 것.

### 12.2 `deploy.sh` 안의 죽은 TLS 설정 — **잠재 위험**(오판 유발)

`nginx/nginx.conf`의 `listen 443 ssl` 블록이 전부 주석 상태인데 ACME challenge location은 살아 있다(§10.2). "HTTPS가 설정돼 있다"는 오독을 유발한다 — 실제 TLS 종단은 Cloudflare Tunnel이다.

### 12.3 스테일 주석 — **잠재 위험**(틀린 불변식을 심는다)

| 위치(심볼) | 주장 | 실제 |
|---|---|---|
| ~~`routers/stocks.py::_usdkrw_rate` docstring~~ | ~~"FX 배치(get_fx)가 채운 영구 캐시를 읽는다"~~ | **해소(2026-08)** — 배치 `fx_fetch`가 실재하고 docstring이 배치/요청경로 두 작성자를 구별한다 |
| `scheduler/jobs.py`(2곳)·`routers/stocks.py` | 풀이 `maxconn=10` | 실제 20(§4.2) |
| `tests/test_batches_router.py` 함수명 | `test_lists_sixteen_batches...` | 33을 단언(§9.4) |
| ~~`services/ranking_service.py::_fetch_naver_market` docstring~~ | ~~"한 페이지라도 실패하면 RuntimeError"~~ | **해소(2026-08)** — 0페이지(200+`totalCount:0`)와 커버리지 미달을 실제로 던지고 docstring이 실패 클래스 3종을 명시한다 |

### 12.4 리포지토리 위생 — **잠재 위험**(악화 중)

루트에 `screenshots-uat*` 디렉터리 90여 개 + `screenshots-*` 변형이 전부 untracked로 쌓여 있다. `.forge/` 산출물, `.planning/`, `.superpowers/`, `.worktrees/`, `supabase/`(제거된 인프라의 잔재)도 공존한다. `git status`가 사실상 판독 불가라 **§10.1의 폴러가 무엇을 날릴지 눈으로 확인하기 어렵다**.

### 12.5 `backend/migrations/`가 죽었다 — **확인된 버그**(문서·구조)

`001_user_events.sql`·`002_backlog_history.sql`을 참조하는 스크립트·compose·모듈이 **하나도 없다**. 마이그레이션 디렉터리의 존재가 "마이그레이션 체계가 있다"는 오해를 만들지만 실제 자동 경로는 `main._migrate()`뿐이다(ADR-0006).

### 12.6 코드 주석이 이 문서의 섹션 번호를 인용하고 **절반이 stale** — **잠재 위험**(신규 실측)

`CONCERNS §N` 인용은 코드 8곳 + `API_SPEC.md` 1곳 = **9건**이다. 이번 판에서 각각이 실제로 가리키는 절과 대조한 결과:

| 인용 위치 | 인용 번호 | 이번 판의 실제 절 | 상태 |
|---|---|---|---|
| `backend/main.py` (`_validation_error_handler`) | §3 | §3 NaN/Inf | ✅ |
| `backend/routers/stocks.py` (`_usdkrw_rate`) | §3 | §3 | ✅ |
| `backend/routers/stocks.py` (`_build_all` sanitize) | §3 | §3 | ✅ |
| `backend/tests/test_stocks_router.py` | §3 | §3 | ✅ |
| `scripts/uat271-formatter.mjs` | §9.3 | §9.2(recharts/jsdom) | ⚠️ 하위번호 이동 |
| `backend/services/db.py` (`_get_pool`) | §4.2 | §4.2 커넥션 풀 | ✅ (이번 판에서 §4.5→§4.2로 **정렬시킴**) |
| `backend/routers/recommendations.py` | §1 | §3 NaN/Inf | ❌ stale |
| `backend/routers/calendar.py` | §7 | §6.9/§12(FOMC 정적 목록) | ❌ stale |
| `backend/routers/batches.py` | §7 | §6.9 | ❌ stale |
| `API_SPEC.md` (FOMC 커버리지) | §7 | §6.9 | ❌ stale |

**대분류(§0~§14) 번호는 이번 판에서 바꾸지 않았다.** 커넥션 풀은 직전 판의 §4.5에 있었는데 `db.py`가 §4.2로 인용하고 있어, **문서 쪽을 인용에 맞춰 §4.2로 옮겼다**(코드를 건드리지 않고 참조 1건을 복구). 남은 stale 4건은 코드·문서 수정이 필요하며 이 문서 단독으로는 닫을 수 없다.

⚠️ **줄번호 참조는 이 문서에서 가장 드리프트가 심한 축이다.** 이번 판은 그 위험을 낮추기 위해 **줄번호를 거의 쓰지 않고 심볼명으로만 지목**했다. 백엔드 코드에 줄을 넣고 빼는 슬라이스는 시프트가 부위별로 달라 산술 추정이 틀리므로, 참조를 갱신할 땐 `git show HEAD:<file>`로 옛 줄을 읽어 **의미로** 재확정할 것.

---

## 13. `CLAUDE.md`·직전 판의 서술 중 지금과 다른 것

### 13.1 이번 패스에서 **반증**된 것

| 서술 | 실제 |
|---|---|
| "`get_connection()`이 정상 종료 시 커밋한다 — 롤백 전제 코드가 성립하지 않는다" | **롤백 경로가 있다**(`except Exception: conn.rollback(); raise`). 진짜 잔여는 `execute()` 루프의 문장 간 원자성 부재다 — §4.3 |
| `short_sell_service`·`investor_service`·`lending_service`·`leverage_service`가 delete-rewrite | 전부 **append-only upsert**, `DELETE` 없음. 빈 fetch가 이미 안전한 no-op — §1.4 |
| `services/guru_scraper.py::save_guru_managers` | 그 심볼은 **존재하지 않는다**. 실제 writer는 `services/storage/schedule.py::save_guru_managers`이고 저장소에서 가드가 가장 촘촘한 함수다 |
| `market_cache`는 `force=True` 배치 전까지 영구 서빙 | 전제는 맞으나 **어떤 배치도 `get_or_refresh`에 `force=True`를 넘기지 않는다** — 배치는 `_fetch_and_save_*`를 직접 부른다 — §6.3 |
| "B27 랭킹 마켓 토글 레이스" | **닫혔다** — `Ranking.jsx::fetchPage`가 `genRef`를 `.then`·`.catch`·`.finally` 전부에서 검사한다 — §7.3 |
| 무인증 엔드포인트가 리스크 표면 | 정확히 9개, 전부 `auth.py`, 사용자 데이터 노출 0건, allowlist 테스트와 드리프트 0 — §5.1 |
| `services/analysis_service.py`가 NaN을 흘린다 | 내부에 `math.isfinite` 가드가 있다. 잔여는 sanitize 안전망 부재뿐(낮음) — §3.3 |

### 13.2 이번 패스에서 **재검증하지 못한 것** — 미확인

직전 판의 §0에 있었으나 `20dd46e` 코드로 확정하지 못한 항목. **해소된 것이 아니라 확인하지 않은 것**이다.

> **판정 완료: 2026-08-11 (task#292, 9차 버그 헌트 LC 판정 레인).** 아래 8건을 **현재 코드 직독**으로 판정했다(추정 금지 — 각 판정에 코드 인용 첨부). **8건 중 7건이 판정됐고 1건만 이월**로 남는다. 열림으로 확정된 6건은 **§0으로 이동**했고(기존 번호 복귀 `B8`·`B30` + 무번호였던 4건에 신규 번호 `B60`~`B63`), 닫힘 1건은 아래 「해소」로 옮겼다.
>
> **판정축은 2축이다** — **생존**(열림/닫힘/부분/판정불가) × **위치**(제자리/이동/소멸). 한 축에 섞으면 "이동하며 닫힘"이 표현 불가라 판정기가 임의로 하나를 고르게 되고, **그 선택은 판정기 탓이 아니라 축 설계 탓**이다(8차에 실제로 그 일이 났다 — 8차 회고 학습 3).
>
> **판정기의 이빨을 대조군으로 검증했다** — 답이 알려진 2건(`B1` = 열림 / 구 `B50` = 닫힘)을 **어느 것이 대조군인지 알리지 않고(블라인드)** 8건에 섞어 투입해 **2/2 기대대로** 나왔다. 대조군 없이는 "대상이 안 그렇다"와 "판정기가 못 본다"가 구별되지 않는다(가토 ⑧ⓔ).

| # | 항목 | 생존 | 위치 | 판정 근거 | 이동 |
|---|---|---|---|---|---|
| B8 | 컨센서스 `report_date`가 UTC 변환으로 하루 밀림 | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 (LOW) → **해소**(task#330) |
| B30 | 티커 유니버스 캐시가 **축소된** 스크레이프를 무검증 저장 | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 (MEDIUM) → **해소**(task#329) |
| B33 | `any(snap_dist.values())`가 진짜 0/0/0을 결측으로 오판 | **닫힘** | 제자리 | **구조적 배제** — `market/kr.py::get_analyst_data_kr`의 세 버킷(`c>=3.5` / `2.5<=c<3.5` / `c<2.5`)이 실수선을 **완전 분할**하고, `market/__init__.py::get_analyst_data`도 yfinance 5열을 3버킷으로 완전 분할한다. 따라서 `buy+hold+sell==0 ⟺ 파싱된 평가 0건`이 참이고, 그 상태에서 mart 보충은 주석이 명시한 **의도된 폴백**이다 | → 해소 (아래 주의) |
| — | `_filter_outliers`가 저장 시계열을 영구 손상 | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 **B60 (HIGH)** → **해소**(task#303, ADR-0040) |
| — | Naver 재무를 **위치 인덱스**로 읽는다 | **열림** | 제자리 | 현재 코드 인용 확인. 직전 판이 "다음 매핑의 우선 대상"으로 지목한 그 항목 | → §0 **B61 (HIGH)** → **해소**(task#303, ADR-0040) |
| — | `_table_unit`의 억원 기본값 폴백(×100 오저장 클래스) | **열림** | 제자리 | 현재 코드 인용 확인 | → §0 **B62 (MEDIUM)** → **해소**(task#328, `B64`와 함께) |
| — | 프론트 포매터 중복 15종 | **열림** | 제자리 | 재계수 수행 | → §0 **B63 (LOW)** |
| — | 인메모리 캐시 스레드 안전성의 실제 사고 가능성 | ~~판정불가~~ → **열림** → **해소**(task#330: B69·B68·B77 전건) | 제자리 | ~~도구 범위 밖 — 동시성 재현이 필요하다~~ → **판정 완료(2026-08-21, task#325).** 「계속 미룰지 vs 하니스를 만들지」의 답으로 **하니스를 만들었다** — `threading.Barrier` + monkeypatch로 강제 인터리빙을 주입해 로컬 `.venv`(py3.9, DB 미접촉, 라이브 쓰기 0)에서 재현했다. 산출 4건: `TTLCache.get`/`invalidate` 무잠금 **KeyError 재현**(→ B69) · `TTLCache.get` single-flight 부재 → `loader() call_count: 2` 재현(단 `§4.2`의 기지 위험이라 REFUTED) · `ProgressTracker` 비원자적 start → `done(2) > total(1)` 불변식 위반 재현(→ B77) · `save_guru_managers` RMW 락 부재(→ B68). **비용은 하니스 몇 줄이었다** — 「도구 범위 밖」이라는 문구가 2사이클을 버틴 것에 비해 훨씬 싸다 | → §0 **B69 (LOW)** · 파생 **B68**·**B77** |

> **재판정: 2026-08-21 (task#325, 10차 버그 헌트 C 판정 레인).** 위 8건이 아니라 **`§0`의 열린 29건 전수**를 재판정했다(분모 31 = 29 + 표에서 제거된 `B60`·`B61`). 결과: **열림 28 · 닫힘 2 · 부분 1 · 판정불가 0**, 위치 전건 제자리 — **닫힌 것이 0건**이다. `B57`만 도달조건이 축소돼 재서술했다(§0 참조).
>
> **블라인드 대조군 3건이 기대대로 나왔다**(`B54`=열림 / `B60`·`B61`=닫힘, 어느 것이 대조군인지 판정기에게 알리지 않았다) **그리고 메인 세션의 독립 코드 판독과도 3/3 일치**했다 — 9차 학습의 「검증기의 판정 자체도 메인 세션이 대조할 것」을 이행했다. 판정 근거를 **문서의 해소 주장이 아니라 현재 코드 인용**으로 요구한 것이 효과가 있었다(프롬프트에 「`CONCERNS.md`가 「닫힘」이라고 *말하는 것*은 근거가 아니다」를 못박았다).
>
> ⚠️ **부수 정정**: C 레인이 `B61`의 `closed_by`를 「task#303, ADR-0040」으로 적었으나 **ADR-0040은 B60(시계열 이상치 필터)의 ADR**이다. `B61`(Naver 위치 인덱스)을 닫은 것은 **task#303**이 맞고 ADR-0040은 그 결함의 근거 문서가 아니다.
>
> ⚠️ **10차 방법론 실패 1건 — 블라인드가 계획 수준에서 깨져 있었다.** A·B 렌즈에게 `§0` 파일을 숨겼고 렌즈들이 실제로 지켰으나(`scanned`에 「§0[33-98] 의도적으로 미열람」 기록), **계획서의 「볼 것」 자체가 `§0` 항목 2건을 실질적으로 복창**했다(`B9`의 refresh 경로 부재 → B1 렌즈 지시문 · `B62`의 억원 폴백 → B4 렌즈 지시문). 그래서 「렌즈가 §0을 모르고 독립 재발견하는가」 지표(**0/18**)는 **무효**다. **일반 교훈**: 블라인드는 「그 문서를 못 읽게 하는 것」이 아니라 **「그 내용이 어떤 경로로도 닿지 않게 하는 것」**이고, 렌즈에 「볼 이유」를 풍부히 주는 것(9차 학습 2)과 **직접 충돌한다** — 「볼 것」의 재료가 결국 결함 카탈로그에서 오기 때문이다. 블라인드를 재려면 「볼 것」을 **개별 항목이 아니라 가토의 결함 *클래스*에서만** 파생시켜야 한다.

⚠️ **B33 닫힘은 8차 판정의 정정이다.** 8차 리포트의 「판정 뒤집기」 절이 이 줄을 **CONFIRMED**로 확정했는데, 9차 메인 세션이 직독해 **닫힘이 옳음을 확정**했다. 8차의 논증(기각자가 쓴 불변식 `합==0 ⟺ 커버리지 0`이 거짓임을 반례로 증명)은 **사실이지만 결론이 과하다** — 판정에 필요한 불변식은 `합==0 ⟺ 파싱된 평가 0건`이고 그것은 버킷 완전분할에 의해 참이다. **기각 논리를 깨면 그 건은 *확정*이 아니라 *미판정*으로 돌아간다**(일반 교훈: 기각을 무너뜨린 뒤 "이 도달 가능한 상태에서 코드의 실제 동작이 틀렸는가"를 독립으로 다시 물어야 한다).

### 13.3 원인 귀속을 **단정하지 말 것**으로 남는 것

- **"배포 후 백엔드가 `Up`인데 API가 5분+ 무응답"** — lifespan 자체는 0.6초로 실측됐고 배치는 스케줄러 스레드라 비블로킹이다. 정확한 메커니즘(GIL/이벤트 루프 기아 등)은 **미확정**이다. §6.6의 `sched.start()` 블로킹은 코드로 확인된 *별개* 경로이며 그 현상의 확정 원인으로 귀속하지 말 것.
- **"005930이 정확히 70000.0으로 박제"** — 피드 글리치가 아니라 **로컬 pytest가 prod DB에 쓴 오염**이 유력하고, 실제로 멈춘 것은 `conftest._block_real_db`(§9.1)였다. 박제-시 독립피드 게이트와 2-of-N 다수결은 **미래 글리치 보험으로 유효**하나, 관측된 70k에 발동한 적은 없다. 라운드 70k가 또 보이면 피드보다 **테스트 오염을 먼저 의심**할 것.

---

## 14. 계획됐지만 미실행인 것

`.forge/backlog/`는 **비어 있다** — 대기 중인 계획 0건.

`.forge/adr/`엔 ADR 35건이 활성(`0001`~`0035`)이고 `retired/`는 없다.

이 문서가 식별한 **후속 후보**(계획으로 승격되지 않은 것):

| 우선순위 | 항목 | 절 |
|---|---|---|
| 1 | 에러 바운더리 신설 — §7.2의 크래시 7곳이 현재 전부 백지다 | §7.2 |
| ~~2~~ | ~~`_fetch_naver_market`의 0페이지 가드(형제 US 경로와 대칭화)~~ → **완료(2026-08)** | §1.1 |
| ~~3~~ | ~~`fx` 배치 신설~~ → **완료(2026-08, `fx_fetch`)**. 잔존: `_usdkrw_rate`에 **나이 검사·stale 마커는 여전히 없다** | §6.4 |
| 4 | 로그인 레이트리밋(bcrypt CPU 고갈 DoS) | §5.6 |
| 5 | `Reports.jsx`·`Ranking.jsx::onRowClick` 세대 가드(잘못된 종목 수치 렌더) | §7.3 |
| 6 | **남은 18개 잡**을 `Run.set_status` 패턴으로(키 미설정이 success로 기록되는 문제) — 배선 1→14 진척(task#329). **최우선은 `macro_signals_fetch`**(B6 잔존 절반, `FRED_API_KEY` 미설정이 지금도 초록) | §6.1 |
| 7 | `_migrate`에 후발 테이블 4개 + `tickers` 컬럼 3개 추가 | §4.1 |
| 8 | `test_no_bare_today.py`를 `datetime.now()`까지 확장 | §6.8 |
| 9 | `BATCHES` 개수·집합 단언 **4파일 8지점**을 구조 단언으로 교체(옛 판의 "3곳"은 지점 수가 틀렸다 — `TESTING.md §5.6`) | §9.4 |
| 10 | §13.2의 미확인 7건 재검증(특히 Naver 재무 위치 인덱스 파싱) | §13.2 |
