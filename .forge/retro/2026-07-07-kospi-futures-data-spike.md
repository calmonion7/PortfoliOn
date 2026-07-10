# 2026-07-07 — 코스피200 선물 데이터 확보 확인 (KIS 게이트형 스파이크, task#155)

게이트형 스파이크. 단일 조사 서브에이전트(general-purpose, sonnet/eco)로 라이브 KIS 프로빙+웹/KRX 조사. tracked 파일·커밋 없음. verified: yes(확보 성공). 후속 "선물 차트 빌드" 태스크로 연결.

## Plan vs actual
- What went as planned:
  - 계획한 관측 완료기준("실 일봉 ≥20봉 + 해결 코드")을 초과 달성 — KOSPI200 선물 최근월물 코드 `A01609`(F 202609) 해결 + 실 일봉 **66봉** 라이브 확보(TR `FHKIF03020100` inquire-daily-fuopchartprice; 가격 TR `FHMIF10000000`). 가격 1247.50·베이시스 KOSPI200(1225.57) 정합, 거래량 4월→7월 증가 패턴이 만기 사이클과 일치.
  - 롤오버 전략 확정: 코드 규칙 `"A01"+연%10+월`(분기월 3/6/9/12) + `inquire-price` 응답의 `futs_last_tr_date`로 만기 판정(하드코딩 캘린더 불요). 종목코드 정본 = KRX/KIS 마스터 파일 `fo_idx_code_mts.mst.zip`(기초자산명==KOSPI200·상품종류==1 필터).
  - 스파이크를 워크플로우 대신 단일 조사 에이전트로 처리 — 노이즈 프로빙 격리, 판정만 회수(적절했음).
- Divergences:
  - **그릴링 결론이 틀렸다 — 프로브 파싱 버그(중대)**: fg-ask 그릴링서 "추측 코드 전부 빈 output → 코드 미해결이 유일 관문"이라 단정했으나, 실제 원인은 코드 오류가 **아니라** 파싱 버그였다. KIS 선물 시세 TR(`inquire-price`/`inquire-daily-fuopchartprice`)은 응답이 `output`(단수)이 아니라 `output1`/`output2`/`output3`으로 쪼개져 온다. 그릴링 프로브가 `d.get("output")`만 읽어 `rt_cd=0`인데도 항상 빈값으로 보였을 뿐, 데이터는 처음부터 와 있었다. → 게이트가 사실은 처음부터 열려 있었다.
  - 야간선물: 2025-06-09 KRX 자체 야간시장(18:00~06:00) 전환으로 동일 코드(A01609) 주·야간 통합 가능성 높으나 **야간 시간대 라이브 미검증**(스파이크 시점 제약) — 후속 야간 1회 스팟체크로 확정 필요.

## Learnings
- Do differently next time:
  - **외부 API "rt_cd=0인데 빈 데이터"면 코드/파라미터 오류로 단정하기 전에 응답 *봉투 구조*부터 확인** — KIS 선물옵션 시세 TR은 `output1`/`output2`/`output3` 분할 응답이다(주식 현재가 `output` 단수와 다름). **라이브 프로브의 맹점: fetch가 200이어도 *파싱*이 틀리면 거짓음성**을 낸다. "프로브 선행" 규율은 fetch뿐 아니라 **응답 shape 파싱까지 검증해야** 완성이다(fixture-pass-live-fail 가족의 프로브판 — 이번엔 그릴링 프로브 자체가 그 함정에 빠져 게이트를 '닫힘'으로 오판). → **CLAUDE.md gotcha 승격 후보**(글로서리 아님·구현 디테일이라 CONTEXT/ADR 미승격).
  - 파생 종목코드는 추측 불가 — KRX/KIS 마스터 파일이 정본. 최근월물은 마스터에서 필터, 만기는 응답 필드 신뢰.
- 검증 게이트: 실 일봉 66봉+코드 라이브 확보로 관측기준 충족 → verified: yes.

## Doc updates
- CONTEXT.md promotion: none — "코스피200 선물"은 후속 빌드 태스크가 시장지표에 실제 편입될 때 용어 등재가 적기(스파이크 단계 등재는 조기).
- ADR added: none — **ADR-0011(KIS 읽기전용 경계) 확장(국내선물옵션 시세 TR 편입)은 *후속 빌드 태스크*의 몫**이다(그때 실제 연동이 하드결정·경계확장으로 성립). 스파이크는 확보 가능성만 확인.
- 후속: (1) **CLAUDE.md gotcha** "KIS 선물옵션 시세 TR = output1/2/3 분할 응답 + 프로브는 파싱까지 검증"(fg-quick 후보). (2) "코스피200 선물 차트 빌드" fg-ask 그릴링 — 지침은 `done/.../kospi-futures-data-spike/run.md`(롤오버 공식·TR·ADR-0011 확장·야간 검증·#154 4번째 드라이버 편입 검토).
