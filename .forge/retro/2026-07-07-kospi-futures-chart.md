# 2026-07-07 — 코스피200 선물 일봉 차트 (KIS, task#156)

Dynamic Workflow 4-phase(Build S1→S2→S3→S4 직렬 → 적대적 Review → Fix → Gate), eco. verified: yes·배포(fdd81a4). 이후 **standalone 적대적 재검토**(fg-adversarial-review)로 추가 결함 4종 → fix-forward #157. divergence 중간(설계·ADR 건전, 구현 엣지케이스).

## Plan vs actual
- What went as planned:
  - 4슬라이스 계획대로: `kis/futures.py`(최근월물 코드+output1/2/3 파싱, S1이 **creds 주입 라이브 프로브로 필드 위치 확정** — fixture-pass-live-fail 회피) → `market_indicators/kospi_futures.py`(요청경로·수동 폴백·dormant-safe·NaN sanitize) → GET `/api/market/kospi-futures`+API_SPEC → `KospiFuturesSection`. Gate 백엔드 1212 pass·프론트 build ok. 라이브 UAT: A01609/price 1247.5/basis 21.93/100봉.
  - fg-run 내장 적대 리뷰가 **basis→mrkt_basis** 필드버그(이론 베이시스 vs 실제 선물−현물) 포착·Fix.
- Divergences:
  1. **standalone 적대적 재검토가 fg-run 리뷰·UAT가 놓친 결함 4종 포착 → #157 fix-forward**: (A major) 성공(rt_cd=0)-but-빈/all-None 응답이 `_mc_save`로 last-good 클로버('wrong<missing' 위반 — `indices.py`의 `if any(v is not None...)` 가드 부재), (B) 그를 못 잡던 테스트갭, (C) bare `date.today()` UTC(kospi_signal.py는 `ZoneInfo("Asia/Seoul")`), (D) 미설정 vs 일시실패 프론트 오표시. 전부 code kind(설계결함 0).
  2. 응답 top-level `timestamp` 없음(플랜 언급) — S4가 없는 필드 안 지어냄(정직). low 후속.
  3. `fetch_daily(120)`→100봉(KIS 일봉 TR ~100행 캡). 차트 ~5개월로 충분, 페이지네이션 미추가(YAGNI).

## Learnings
- Do differently next time:
  - **행복경로 UAT는 "성공-but-빈/부분 응답" 분기를 못 친다 — 외부연동 기능은 그 엣지를 명시 테스트하거나 적대적 재검토를 돌려라.** 이번 major 결함(빈응답 클로버)은 fg-run 내장 리뷰(변경 diff의 명백한 correctness 중심 — basis는 잡음)와 라이브 UAT(정상 데이터일 때 실행) 둘 다 통과했고, "결과가 틀렸다고 가정"하는 standalone 적대 리뷰의 'where it fails' 렌즈가 잡았다. → 적대적 재검토가 실제로 값을 한 사례.
  - **요청경로 시장지표 fetch는 빈결과를 last-good 위에 박제하지 말 것** — `indices.py`의 `if any(v is not None...)` 지속 가드 패턴을 신규 모듈에도 적용(wrong<missing). #157에서 수정.
  - **KIS 선물옵션 시세 TR = output1/2/3 분할 응답**(주식 `output` 단수와 다름) — "rt_cd=0인데 빈값"이면 봉투 구조부터 의심. 라이브 프로브는 fetch뿐 아니라 *파싱 shape*까지 확인해야 완성(#155·#156 반복 교훈).
  - **KIS 표시 베이시스 = `mrkt_basis`(선물−현물), 이론 `basis` 아님** — 필드명 유사·값 상이(21.93 vs 5.41). 외부 API 유사 필드는 라이브 값으로 시맨틱 확인.
  - **KR 시장-날짜 판정은 `ZoneInfo("Asia/Seoul")`** — 컨테이너 UTC라 bare `date.today()`는 00:00~09:00 KST에 하루 어긋남(KR beta tz-strip 가족). kospi_signal.py `_KST` 패턴 재사용.
- 검증 게이트: pytest 1212·프론트 build·fg-run 리뷰 basis Fix·라이브 프로브·standalone 적대 리뷰(4종→#157) → verified: yes.

## Doc updates
- CONTEXT.md promotion: none — 「코스피200 선물」은 fg-ask 그릴링서 등재.
- ADR added: none — ADR-0022(KIS 국내선물 경계)는 그릴링서 추가.
- fix-forward: **#157 kospi-futures-chart-fix**(A+B+C+D, high) — 백로그 대기, fg-run이 실행.
- **CLAUDE.md gotcha 후보(fg-quick 일괄)**: ① KIS 선물 TR output1/2/3 분할(+#155 잔여) ② KIS 베이시스 mrkt_basis vs basis ③ 요청경로 시장 fetch 빈결과 클로버 방지(indices.py if-any 가드) ④ KR 날짜 KST. (#157이 코드 수정, 가토 문서화는 별도.)
