# 2026-06-15 — README.md 전수 재조정 (task #47)

## Plan vs actual

- **계획대로**: S1 README 전 섹션 재조정 done. 플랜 체크리스트 전 항목 반영 — 인프라(certbot·cloudflared=launchd), 환경변수(ANTHROPIC 제거·실제 키 전면 교체·LLM 미호출 노트), 기술스택(React19/Vite8/router7), 아키텍처(report_generator LLM 미호출 사실오류 수정·routers 17·services·tables), 프로젝트 구조(kiwoom/kis/market_indicators), 참고문서(KIWOOM/KIS/CLAUDE). 직접 인라인 실행(Dynamic Workflow·코드리뷰 생략 — 저위험 doc-sync). 변경 README.md 단일 파일(103+/91-). `verified: n/a`(문서 전용, 전 주장 코드 교차검증). commit c9195190 push.
- **Divergences**:
  - **(중요) 플랜 체크리스트가 stale CLAUDE.md를 답습한 오류 — 코드로 정정**. 플랜은 "리서치 허브(리포트·캘린더·다이제스트), 시장 허브(시장지표·분석·랭킹·수급지표)"라 적었으나 코드 정본은 달랐다: 리서치=리포트·**랭킹**·다이제스트·캘린더, 시장(MarketHub)=Market만 렌더(시장지표·수급지표 **2탭**), 분석=종목관리 분석탭 통합, 수급스크리닝=독립 탭 아님(랭킹·리포트 공유). README는 실행 중 허브 컴포넌트(Research.jsx·MarketHub.jsx·Market.jsx)를 읽어 코드 기준으로 작성.
  - "즉시 생성 국내/해외 분리" 주장 철회 → "즉시 생성·과거 백필(admin)"(수동 트리거 시장분리 미확인, 검증 안 된 주장 회피).

## Learnings

- **Do differently next time**:
  - **문서 재조정의 1차 정본은 *코드*다 — "권위 있는" 프로젝트 문서(CLAUDE.md)조차 stale할 수 있다.** 이번 plan 체크리스트는 CLAUDE.md frontend 절을 신뢰해 허브 구성을 잘못 기재했고, 실제 컴포넌트를 읽고서야 정정됐다. fg-ask 그릴링이 env·nav·스택은 코드로 grounding했지만 허브 *탭 구성*은 CLAUDE.md만 보고 plan에 박제 → 실행 단계 교차검증이 안전망. 교훈: doc-sync/문서검증 작업은 상위 요약문서가 아니라 해당 구현 파일을 1차 소스로 grep/read하고, plan에 적힌 "현황" 주장도 그대로 믿지 말 것.
  - **single-file doc 작업은 워크플로우보다 직접 인라인이 맞다**: 팬아웃·병렬 이득이 없고, 사실 교차검증(여러 코드 파일 grep)을 같은 컨텍스트에서 즉시 하는 게 빠르고 정확. fg-run의 "small scale면 직접 처리" 가이드대로 했고 적중.
- **검증 게이트**: 문서 전용이라 runnable UAT 없음(`verified: n/a`). 대신 README 전 주장을 docker-compose(4컨테이너)·routers(17)·services·package.json(React19/Vite8)·허브 컴포넌트·env grep으로 교차검증, 잔여 사실오류 0. repo 관행([[feedback-verification]]) 라이브는 배포 후 글랜스.
- **후속 후보**: 없음(CLAUDE.md 허브 설명 stale는 이 회고에서 즉시 정정·promotion 완료). README의 나머지 화면 세부(예: Analytics 페이지 실제 사용처)는 overview 수준이라 미상세.

## Doc updates

- CONTEXT.md promotion: none (허브/탭은 UI 구조지 도메인 용어 아님).
- ADR added: none (README 재조정·doc 정정은 가역적·비-의외·trade-off 없음 → 3조건 미충족).
- **CLAUDE.md: line 112 frontend 허브 설명 정정**(이 회고 학습 promotion) — Research=리포트·랭킹·다이제스트·캘린더, MarketHub=Market(시장지표·수급지표 2탭), 개별 페이지에 Ranking 추가. 코드 기준으로 stale 제거.
- 코드: commit c9195190(README 재조정, main push) + 회고 CLAUDE.md 정정(별도 커밋 예정).
