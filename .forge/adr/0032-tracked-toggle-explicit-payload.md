# 0032 — 추적 상태 토글은 명시 payload를 받는다 (백엔드 기본값에 기대지 않는다)

- 상태: 채택 (Accepted)
- 날짜: 2026-08-02
- 관련: task#273, [[ADR-0031]](0031-formatter-name-carries-input-unit.md), `.forge/codebase/CONCERNS.md` §7.7, `CONTEXT.md`「추적 상태 (Tracked Status)」

## 맥락 (Context)

`hooks/useTrackedStocks.js`의 `toggle(ticker, name, isWatched)`는 `POST /api/watchlist`에 **2필드**만 보낸다:

```js
await api.post('/api/watchlist', { ticker, name: name || ticker })
```

백엔드 `WatchlistStock`(`routers/watchlist.py:33-41`)의 나머지 필드는 **기본값**을 탄다 — `market="US"` · `exchange=""` · `security_type="EQUITY"`.

이 훅의 소비처는 도입 당시(task#266) 구루 4페이지뿐이었고, 구루 보유는 전부 US 13F다. 즉 **기본값이 우연히 맞았다.** 아무도 이 2필드 payload를 결함으로 보지 않았고, 훅의 docstring도 payload를 언급하지 않는다.

그런데 그 훅에 랭킹·추천을 흡수하면 **KR 종목이 처음으로 등장한다.** 2필드 payload를 그대로 쓰면:

- KR 종목이 `market="US"`로 `tickers`·`user_stocks`에 **영구 저장**된다 → 시세 체인이 yfinance(US)로 가서 KR 종목은 시세를 못 받는다
- `add_watchlist_stock`의 **KR 상장폐지 검사가 통째로 건너뛰어진다**(`watchlist.py:69-73`은 `if stock.market == "KR"` 안에 있다)
- `exchange`가 비어 KOSPI/KOSDAQ 구분이 사라지고, ETF가 `EQUITY`로 저장된다

기존 두 소비처는 이미 5필드를 손수 만들어 넘기고 있었다(`Ranking.jsx:192-198` · `Recommendations.jsx:128-134`). 즉 **훅이 좁은 쪽이었고, 통합이 넓은 쪽을 좁은 쪽에 맞추려던 것**이 함정이었다.

## 결정 (Decision)

1. **시그니처를 `toggle(payload, isWatched) -> Promise<boolean>`으로 바꾼다.** payload는 `WatchlistStock`이 받는 필드 집합(`ticker`·`name`·`market`·`exchange`·`security_type`)이다.

2. **모든 호출부가 `market`을 명시한다 — 기본값에 기대지 않는다.** 구루 페이지도 `{ ticker, name, market: 'US' }`를 쓴다. 지금 그 값은 백엔드 기본값과 같지만, **같다는 사실이 코드에 적혀 있어야** 다음 KR 소비처가 조용히 깨지지 않는다.

3. **payload는 컴포넌트 상태가 아니라 *행 데이터*에서 파생한다.**

   ```js
   const isUs = row.exchange ? row.exchange === 'US' : market === 'US'
   ```

   랭킹 행은 `exchange`를 `'KS'`/`'KQ'`/`'US'`로 준다(`ranking_service.py:60,76`). 컴포넌트의 `market` 상태를 읽으면 **B27(마켓 토글 레이스) 창에서 KR 행을 US로 등록**한다 — 그 레이스는 자동 회복이 없어 창이 무기한이다. 행에서 파생하면 그 오염 경로가 레이스와 무관하게 닫힌다. `row.exchange`가 없을 때만 컴포넌트 상태로 폴백한다.

4. **수급 스크리닝 행은 예외로 문서화한다.** `/api/investor/screening`은 `exchange`·`is_etf`를 반환하지 않는다(`investor.py:_serialize_screening`). 이 탭은 KR 전용이므로(`Ranking.jsx:120-122`가 US 전환 시 `value`로 폴백) 폴백이 KR·`'KS'`로 떨어지며, 이는 **기존 동작과 동일**하다(개선이 아니라 보존).

## 고려한 대안 (Alternatives)

1. **선택적 네 번째 인자** `toggle(ticker, name, isWatched, extra?)` — 구루 호출부 변경이 0이라 가장 싸다. **기각**: 지금의 함정(지정하지 않으면 조용히 `market='US'`)을 그대로 보존한다. 다음 KR 소비처가 정확히 같은 자리에서 다시 밟는다.
2. **훅 생성 시 기본값 주입** `useTrackedStocks({ defaults: { market: 'US' } })` — 페이지가 자기 시장을 한 번 선언한다. **기각**: 랭킹은 마켓 토글로 시장이 바뀌고 행마다 갈릴 수 있어, 마운트 시점 고정값이 원리적으로 맞지 않는다.
3. **백엔드에서 `market` 기본값을 없애고 필수화** — 정공법이고 서버가 계약을 강제한다. **기각(이번엔)**: `WatchlistStock`은 `PUT /api/watchlist/{ticker}`와 `StockModal` 경로도 함께 쓰므로 반경이 이 태스크 밖으로 나간다. 별건으로 남긴다.

## 결과 (Consequences)

- **구루 호출부의 `market: 'US'`는 중복처럼 보인다.** 백엔드 기본값과 같은 값을 왜 적는지가 이 ADR이 기록하는 것이다 — 지우지 말 것.
- payload를 행에서 파생하는 규칙 때문에, **랭킹 응답에 `exchange`를 빼는 백엔드 변경은 프론트 저장 정확성을 깬다.** `ranking_service.py`의 `exchange` 컬럼은 표시용이 아니라 load-bearing이다.
- `toggle`의 boolean 반환은 소비처가 성공 시에만 토스트·`trackEvent`를 쏘게 한다. **「실패해도 re-throw 하지 않는다」는 task#244의 결정은 그대로다** — 반환값이 `undefined`에서 `false`로 바뀔 뿐 예외는 여전히 나가지 않는다(`useTrackedStocks.test.js`의 해당 단언은 리터럴만 이전하고 사유를 주석에 남긴다).
- `pending`(in-flight 중복 클릭 방지)을 훅이 소유하게 되어 **구루 4페이지가 공짜로 얻는다** — 지금 `WatchlistBtn`은 인스턴스별 `loading`만 있고 페이지 수준 중복 가드가 없다.

## 되돌리려는 사람에게

**「구루는 어차피 US니까 명시가 불필요하다」는 되돌릴 근거가 아니다** — 그 "어차피"가 정확히 이 결함의 원인이었고, 훅이 US 전용이라는 사실은 어디에도 적혀 있지 않았다. ADR-0031과 같은 기준을 적용한다: 되돌리려면 **무엇이 대신 재발을 막는지**를 먼저 제시해야 한다.

자동 게이트는 `hooks/useTrackedStocks.test.js`(payload 형태·pending·반환값)와 랭킹 회귀 테스트(컴포넌트 `market`을 `'US'`로 강제해도 KR 행 payload가 KR로 유지되는지 — 레이스 면역 단언)다.
