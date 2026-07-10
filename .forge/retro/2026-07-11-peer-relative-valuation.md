# 2026-07-11 — 상대 밸류에이션: 경쟁사 PSR·EV/EBITDA + peer 할인/할증 칩 (task #169)

## Plan vs actual

- What went as planned: S1~S3 전부 MET. `_comp_valuation` psr/ev_ebitda 확장(US=info 재사용·KR ev=yfinance `.KS`→`.KQ` 폴백·KR psr=`_kr_psr` 헬퍼로 메인 TTM 로직 재사용), 메인 KR ev_ebitda None 고정 해소, 프론트 `computePeerPremiums`+칩(중앙값·n≥2·구 스냅샷 graceful), README/API_SPEC. pytest 1268·vitest 62 green. UAT는 07:00 US 배치 박제로 자동 완결 — AAPL competitors_data 실값(KR peer 005930 폴백 경로까지 라이브 검증), MSFT 화면 캡처로 판정 칩 4종 확인 + PSR +88% 수기 검산 일치.
- Divergences (계획 범위 내, 경미 — 전부 in-run 해소):
  - Python 3.9: `-> float | None` PEP 604 애너테이션이 `from __future__ import annotations` 없는 report_generator.py에서 임포트 즉사 → 제거. **파일별 future import 유무 확인 후 애너테이션 문법 결정.**
  - "예외는 기존 except가 삼키되" 문구를 문자 그대로 하면 신규 yfinance 실패가 성공한 Naver per/pbr까지 all-None으로 되돌림 → nested try 격리("한 실패가 형제 값을 죽이지 않는다").
  - `test_report_price_gate.py` fixture가 yf.Ticker 미모킹 → 신규 콜이 테스트에서 라이브 네트워크 탐 (grep 전수확인이 잡음, 계획 밖 파일 1줄 보정).
  - **reload-패턴 테스트에서 self-module 심볼 patch 금지**: patch 후 `importlib.reload(report_generator)`가 모듈 자체 정의 이름(`_comp_valuation`)의 patch를 재정의로 무효화 — 하위 모듈 속성(`_naver_get`/`yf.Ticker`) mock으로 우회. mock 타깃 가토의 *reload판*.
  - API_SPEC에 competitors_data가 통째 미문서화였음 → additive 필드만이 아니라 전체 shape 신규 문서화(기존 placeholder 보존).
- Divergences (계획 밖 — 이번 회고의 본체): **UAT 라이브 스모크가 "로컬 pytest → prod DB 오염" 침묵 사고를 적발**. 로컬 DATABASE_URL이 도커 postgres(=라이브)를 가리키고 conftest에 DB 가드가 없어, generate_report end-to-end 테스트의 스냅샷 INSERT가 prod에 커밋됨. 실존 티커(005930)만 FK 통과해 **선택적 오염**(TEST/COMP1은 tickers 부재로 조용히 실패 → 수년치 green이 격리를 위장). 피해: 005930 스냅샷 11일치+(06-28~07-11)가 fixture(price 70000)로 클로버, admin 테스트는 prod calendar_cache 전체 DELETE 실행 중이었음. 수정: conftest `_block_real_db` autouse 가드(9b540da) + 가드가 드러낸 실 DB 의존 테스트 4건 격리.

## Learnings

- Do differently next time:
  - **"fixture-pass-live-fail" 가족에 *역방향* 신종 추가 — "fixture-writes-live"(테스트가 prod를 오염)**: 지금까지의 가토는 "fixture는 통과하는데 라이브가 깨진다"였는데, 이번엔 테스트 fixture가 라이브 *데이터*를 덮었다. 탐지 신호도 반대 — 라이브 값이 "지나치게 라운드"(70000, 정확히 400조)하면 피드 글리치보다 테스트 오염을 먼저 의심. 대응은 CLAUDE.md 가토로 승급(아래).
  - **오염이 선택적이면 격리가 있는 걸로 오인된다**: TEST 티커는 FK로 실패(무해해 *보임*), 실존 티커만 오염 — "일부는 안 써지니 격리돼 있겠지"는 성립 안 함. 격리는 존재 증명(가드가 raise)으로만 믿을 것.
  - **UAT 라이브 스모크의 가치 재확인**: pytest 1268 green·워크플로우 verify 통과 후에도, 배포 직후 실데이터 눈검사가 이 사고를 잡았다(fixture green이라 테스트로는 원리적으로 못 잡음). "배포 후 해당 표면 라이브 스모크" DoD를 데이터 쓰기 경로에도 유지.
  - **원인 귀속은 오염원 제거 후 재검증 대상**: "005930 70k"를 NXT/KRX 피드 글리치로 3회(task#94/#101/#118) 귀속했으나 유력 진범은 테스트 오염일 수 있음. 신호가 재발하면 과거 결론을 전제하지 말고 오염원(로컬 프로세스→prod 도달 경로)부터 배제할 것. → 후속 태스크로 재조사(가토 서술 과잉 귀속 정정 여부 포함).
  - reload-패턴 테스트의 self-module patch 무효화, PEP 604·future import, nested try 격리 — 위 Divergences 참조(개별 승급 불요, 검색 가능하게 여기 남김).
  - 방치 결정 2건(리뷰 non-must-fix): ① `Math.round(-0)` → 미세 할인(−0.5%~0%)이 "+0% 할증" 표기(dead zone 코스메틱) ② KR 메인 EV/EBITDA fetch가 박제게이트 앞이라 게이트 기각 종목도 콜 1회 낭비. 둘 다 실해 없음 — 재발 시 이 기록 참조.

## Doc updates

- CONTEXT.md promotion: none (Peer 할인/할증은 fg-ask 단계에서 이미 등록).
- ADR added: none (`_block_real_db` 가드는 되돌리기 쉬움 — 3조건 미달, CLAUDE.md 가토가 적층).
- CLAUDE.md: Gotchas에 "로컬 pytest ↔ prod DB" 가드 규율 추가(사용자 승인, 본 회고와 함께 커밋).
- 후속 태스크 후보: **"005930 70k 미스터리 재조사"** — 오염 타임라인(pytest 실행 시각 vs 70k 발생일) 대조, task#94/#101/#118 귀속·박제게이트 가토 서술 정정 여부 판단 (fg-ask로 그릴링).
