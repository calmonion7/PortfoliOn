# 2026-06-16 — 배치 현황 데이터 소스 표시 (task #54)

## Plan vs actual

- **계획대로**: S1~S4 done. batch_registry 20종에 `source`(list[str]) 부여, /api/batches 자동 노출, 배치 카드 "소스" 표시(컴팩트+펼침), CLAUDE.md "소스 변경 시 갱신" 규칙. TDD(전 배치 source 보유)·backend pytest 697·npm build OK. Dynamic Workflow 4에이전트.
- **Divergences**:
  - **(적대적 리뷰 FIXED) daily_report_kr source 누락**: [키움,KIS,Naver]였으나 자동 리포트가 **FnGuide(애널리스트 컨센서스·시총 폴백)**도 fetch → 리뷰가 [HIGH]로 잡아 FnGuide 추가. 나머지 19개 코드 일치.
  - **플랜 힌트 2건 코드 정정**: earnings_kr=**Naver**(yfinance 아님 — yfinance는 earnings_us만), investor_trend=**[키움,Naver]**(키움 우선+Naver 폴백). lending=금융위(KOFIA_API_KEY는 키이름)·leverage=KOFIA 구분, monthly_kr=관세청+UN Comtrade.
  - daily_digest source=["보유종목 시세 집계"] 파생 라벨(실제 yf+FX 라이브, 플랜 승인·리뷰 medium 미변경).

## Learnings

- **Do differently next time**:
  - **플랜의 괄호 "힌트"(코드/API 사실)는 추측이지 정본이 아니다 — 실행은 반드시 코드/라이브로 검증.** 이번 source 매핑 힌트(예 "earnings_kr→yfinance인지 확인")가 틀렸고(Naver), [[kr-sector-precompute-fix]]/#48의 "ka10001 업종 필드 우선"(실제 부재)에 이은 **재발**. fg-ask가 plan에 적는 코드-사실 힌트는 "확인 대상"으로 표시하고, fg-run 실행/리뷰가 코드로 확정하는 게 정착된 안전 패턴(이번엔 백엔드 에이전트+적대적 리뷰가 둘 다 코드 대조로 정정). 정본은 늘 코드, plan 힌트 아님.
  - **메타데이터 정확성 작업엔 "코드 대비 전수 대조" 적대적 리뷰가 본질**: source처럼 "정보를 표시"하는 기능은 틀린 값이 곧 기능 실패 → 리뷰가 20종을 _JOB_FUNCS→service→외부API로 대조해 FnGuide 누락을 잡았다. (단순 lint성 리뷰가 아니라 도메인-정확성 리뷰.)
  - **정적 메타데이터(source)는 또 하나의 staleness 표면** — batch-id 4표면·소스 consumption gotcha와 같은 클래스라, 이번에 박은 CLAUDE.md "fetch 소스 변경 시 source 갱신" 규칙이 그 mitigation(자동 파생은 과해서 정적+규칙 선택).
- **검증 게이트**: 자동 게이트 pytest 697·TDD·npm build·적대적 리뷰(소스 20종 전수 대조, 1건 FIXED)·메인 재확인으로 `verified: yes`. 커밋 b8eb003f push. 잔여 글랜스: 배치 현황 카드 "소스" 표시.

## Doc updates

- CONTEXT.md promotion: none ([[데이터 소스]]는 fg-ask 때 등록 — 사용처와 반대 방향).
- ADR added: none.
- CLAUDE.md: "fetch 소스 변경 시 batch_registry source 갱신(DoD)" 규칙은 실행 중 docs 에이전트가 추가(이번 작업의 유지보수 산출). 신규 회고 승격 없음.
- 코드: commit b8eb003f(기능, main push). 회고 발 코드/문서 변경 없음.
- **process 학습(#1, retro 전용)**: "plan 코드-힌트=추측, 코드/라이브로 검증"은 forge 프로세스 교훈이라 프로젝트 CLAUDE.md 아닌 retro에 기록(재발 시 fg-ask 그릴링이 힌트에 '확인 필요' 명시).
