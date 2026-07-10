# 2026-06-20 — KR 시세-일봉 발산 가드 (task#93)

## Plan vs actual
- What went as planned: 단일 슬라이스 그대로. 워크플로우 없이 직접 처리(단일 파일 ~40줄 + 테스트 3개 — fg-run 비용원칙). `services/market/kr.py`에 `_within_chart`(범위 판정)·`_kr_pick_basic`(키움→KIS→Naver lazy 순회, 일봉 종가 2배 밖 소스 폐기·로그·short-circuit 유지) 추가, `get_quote_kr`이 일봉 페치를 소스 선택 앞으로 옮겨 `ref_close` 확보(추가 콜 0). 가드 테스트 3종 + 전체 843 passed. 배포 main 7f096bf4. UAT: yes(005930 수동 재생성 후 요약탭 현재가·매물대/RSI 정상 — 사용자 확인).
- Divergences: 슬라이스 2(005930 재생성+검증)는 라이브 UAT라 사용자 몫(키움/KIS 서버측 키·prod 분류기 차단). 그 외 계획=실제.

## Learnings
- Do differently next time:
  - **매물대/RSI가 "이상하게" 깨지면 시세 소스 vs 차트 소스 스케일 불일치를 먼저 의심.** 리포트의 가격 마커는 `get_quote_kr`(키움 ka10001 `_AL`→KIS→Naver), 매물대/RSI는 `get_history_df`(키움 ka10081 일봉)에서 온다 — **다른 TR이라 한쪽만 액면/병합 조정되면 5배까지 어긋난다.** 둘이 어긋나면 같은 차트에 마커가 밴드 밖으로 찍혀 "깨진" 것처럼 보인다(원인은 표시 버그가 아니라 박제된 price 값 자체).
  - **진단은 앱 밖 실값부터.** 네이버 공개 API(`m.stock.naver.com/api/stock/{code}/basic`)를 creds 없이 curl해 실값(354,000) 확보 → 앱값(~70k)과 ~5배 격차 특정. "이상함" 같은 모호한 증상은 숫자 격차의 *배수*가 원인 클래스를 가른다(×10/×100=단위, ~5배=조정 불일치, ±몇 %=시간외).
  - **"갑자기"는 코드 회귀 아닐 수 있다 — git log로 먼저 배제.** 시세 체인은 일주일 안정 → 런타임/데이터(배치 박제) 원인으로 방향 확정.
  - **소스 무관 가드 > 소스 특정 수정.** 어느 소스가 틀렸는지 라이브 프로브 없이 모르는 상황에서, "고른 값이 일봉 종가 2배 밖이면 폐기·폴백"은 소스를 특정하지 않고 라이브+스냅샷·전 종목을 막는다. 소수 괴리 소스만 폐기(전원 합의 시 차트가 이상값일 수 있어 미발동)해 오탐을 피함. 'wrong < missing'의 변형.
- 후속: **소스 근본추적** — 어느 소스(키움 ka10001 `_AL` / KIS)가 70k를 왜 반환하는지(액면/병합 조정 불일치 추정) 라이브 프로브. 가드는 증상 차단일 뿐 원인 미해결. → **task#94 백로그 생성**(`.forge/backlog/kr-quote-source-rootcause-probe.md`).

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음 — 발산 가드는 구현)
- ADR added: none (임계 튜닝 쉬움·국소 변경 — 3조건 미충족)
- CLAUDE.md: Gotchas에 "KR 시세 소스 vs 차트 소스 스케일 불일치 → 매물대/RSI 깨짐 + get_quote_kr 발산 가드" 1항 추가(기존 dual-source 가토 결).
