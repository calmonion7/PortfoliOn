# 2026-06-13 — 시세 조회 성능 (2/2): 가격 배치 fetch + sector snapshot화 (task 31)

## Plan vs actual
- What went as planned: `market.get_quotes_batch` 신설(US `yf.download` 1콜 raw 종가 / KR `get_quote` part1캐시), `_build_card`·`_build_all`·`get_portfolio_prices`를 배치 사용으로 배선, `get_quote`(full, ytd/sector)는 report_generator용 보존. backend 468 passed. 최종 라이브: dashboard cold 1.12s·null price 0·sector 정규화·`/portfolio/prices` 정상.
- Divergences (모두 실행 중 측정으로 발견·수정):
  1. **sector via `t.info`가 cold 5.5s 회귀** → 1차 구현(sector를 t.info 롱캐시)이 기준선 1.16s보다 느림. snapshot이 sector를 이미 저장(`report_generator.py:138`)하므로 `_build_card`가 거기서 취하게 바꿔 t.info 패스 **완전 제거**(Option X). 추가했던 `_quote_sector_cache`/`_sector_cached` 철회.
  2. **snapshot sector가 raw** → `_norm_sector` 재적용으로 기존 정규화 표시와 동치 복원.
  3. **테스트 mock 타깃 전환**: get_quote→get_quotes_batch. 안 바꿨을 때 옛 mock이 무력화돼 폴백으로 실제 yf.download 네트워크 호출(테스트 시간↑로 감지).
  4. `auto_adjust=False`(raw 종가) 선택, `parallel_map` 고아 import 정리.

## Learnings
- Do differently next time:
  - **성능 작업의 검증은 "실행 중" 라이브 측정으로.** 유닛테스트(468 green)는 t.info 회귀(cold 5.5s)를 전혀 못 잡았다 — fg-run의 라이브 UAT가 잡아 Option X로 선회. 성능 변경은 구현 직후 실측(cold/warm, 캐시 격리)을 게이트로.
  - **yfinance에서 비싼 건 `t.history`가 아니라 `t.info`다.** dashboard 병목의 실체는 per-card `t.info`(scrape 무거움). 가격(history) 배치만으론 부족했고, t.info 자체를 없애야(파생필드를 snapshot에서) 의미 있는 개선.
  - **외부 API로 재조회하기 전에 snapshot/DB에 이미 저장된 파생필드를 먼저 본다.** sector는 report_generator가 이미 snapshot에 저장 중이었음 — 재호출은 낭비. (단 다른 store에서 가져오면 원본의 변환[`_norm_sector`]을 반드시 재적용.)
  - **함수 호출처를 바꾸면 그 함수를 mock하던 테스트의 patch 타깃도 함께 옮긴다.** 안 그러면 테스트가 "통과"하면서도 실제 네트워크를 때려 flaky/느려짐(폴백 경로로 빠지기 때문).
  - **한계효용 직감은 측정으로 확인됐다**: 재그릴 때 "part2는 현재 스케일에선 효용 작음"을 플래그했고, 실측도 절대 시간 ~기준선(1.12 vs 1.16s)으로 확인. 가치는 구조적(대시보드 yfinance O(N)×(info+history)→O(1) download)·장기 스케일. 작은 절대이득의 리팩토링은 "구조/스케일 이득"으로 정당화되는지 사전에 합의할 것.

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (sector-from-snapshot / get_quote full·batch 분리는 경계선이나 가역적 — 근거는 run/retro에 기록, ADR 3조건 미충족)
