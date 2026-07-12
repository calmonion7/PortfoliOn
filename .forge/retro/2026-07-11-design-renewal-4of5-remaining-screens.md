# 2026-07-11 — 디자인 리뉴얼 4/5: 잔여 화면 정보구조 (task#174)

## Plan vs actual

- What went as planned: S1~S4 전부 MET — 잔여 전 화면(시장 허브 15섹션·랭킹·추천·비교·캘린더·배당·다이제스트·구루 4화면·설정·admin 분석)을 터미널 문법으로 재배치. 29파일 **net −104줄(320 삽입/424 삭제 — 삭제 우위)**, 전부 표시 계층(데이터·API·훅·props·이벤트명 변경 0, 적대 리뷰 회귀 렌즈 확인). 신규 토큰은 대비 실측 후에만(`--tag-etf-*` 라이트 6.9:1/다크 6.7:1, `--medal-gold/bronze`). KR 가격색·의미배지 분리·marketUtils `krFmt` 스케일 가드 준수. Dynamic Workflow(8에이전트, eco 모드 — 전 서브에이전트 sonnet + ECO 규율): 정찰 1 → 순차 구현 4 → 병렬 리뷰 2렌즈 → 수정 1. vitest 69·빌드·라이브 스모크(26캡처 양테마×PC/모바일) green. "중간 빌드 금지(dist 즉시 라이브)" 하드 규칙 준수(빌드는 메인 세션 최종 1회).

- Divergences (전부 실행 재량/리뷰 포착):
  - **정찰 핵심 발견이 작업 성격을 뒤바꿈** — pc.css/mobile.css에 잔여 화면용 컴포넌트 클래스(`.metric-tile`·`.cal-grid`·`.tbl`·`.guru-card`·`.yield-row`·`.pill-warn` 등)가 이미 정의됐으나 **미배선(dead CSS)**이었다. 그래서 4/5는 "새 CSS 작성"이 아니라 "있는 CSS에 JSX를 배선하고 인라인을 걷어내는" 삭제 우위 작업이 됐다.
  - S1: 브리프의 ui/Card+ui/Stat 신규 헬퍼 제안 대신 기존 dead 클래스 채택(ui/Stat이 임의 색·change invert 미지원 → 억지 적용 시 스코프 밖 프리미티브 변형 필요). 신규 추상화 0으로 더 적은 diff.
  - S2: ETF 배지 `--data-5` 재사용 후보를 실측 4.2:1(AA 미달)로 기각 → `--tag-etf-*` 3종 신설.
  - S3: Dividends `STATUS_STYLE` 하드코딩 rgba → `--semantic-buy` 토큰화(스코프 내 발견 버그). Calendar `.cal-cell` min-height 제거(로딩↔로드 후 정사각 셀 CLS 정합). Digest 무변경(이미 준수 — 투기적 리팩터 지양).
  - S4: 다수 파일 assessed-no-change(GuruCrawlNow·ConsensusSettings·PermissionPanel·BatchScheduleEditor·ReportManualGen[브리프가 `<table>` 있다 했으나 실제 없음]·LoginPage[1/5서 정리·스코프 밖]). Button.css 다크 하드코딩 hex는 슬라이스 밖이라 미변경(5/5 이월).
  - 리뷰 2렌즈가 실회귀 6건(2 High + 4 Medium) 포착·전부 수정(0 skip): guru-avatar 라이트 대비 3.24:1(비대칭 회귀), Compare `.tbl-wrap` overflow:hidden으로 5열 표 모바일 잘림, guru-stats/yield-row/kpi-row 그리드 열 수 불일치(빈 열), LeverageBackfillSettings th·td 정렬 어긋남.
  - **가장 중요한 이탈** — 리뷰 수정 에이전트가 AdminAnalytics.jsx에 JSX 주석 컨테이너를 `{summary && (...)}` 안 첫 자식으로 넣어 빌드 파손. vitest 69는 통과(파일 미커버). 메인 세션 컴파일 검증(throwaway-dir `vite build`)이 유일 포착 지점 → 주석 이동으로 수정, 재빌드 green.
  - (자율 루프 진행) 대외 배포·커밋은 사용자 go-ahead 후 실행 — build=라이브라 자율 배포 보류, 사용자 "커밋 푸시" 지시 후 772e1fd 커밋·푸시, Deploy to Production 18s success 확인.

## Learnings

- Do differently next time:
  - **미배선(dead) CSS 클래스를 재사용할 땐 그 클래스의 구조적 전제(그리드 열 수·overflow 동작)가 실제 렌더 항목과 맞는지 배선 전에 대조하라** — 리뷰 6결함 중 5건이 여기서 났다(guru-stats 3열/yield-row 5열/kpi-row 4열 vs 실제 2·4·3개, Compare `.tbl-wrap` overflow:hidden으로 모바일 표 잘림). "있는 CSS 재사용"은 diff를 줄이는 좋은 eco 전략이지만, 그 클래스가 원래 *다른 항목 수·다른 오버플로*를 전제로 설계됐을 수 있다. 유일 소비처면 클래스를 실제에 맞추고, 공유 클래스(kpi-row=Portfolio 소비 등)면 해당 화면만 인라인 오버라이드로 회귀를 피할 것. dead-CSS 배선 슬라이스의 리뷰 렌즈에 "클래스 전제↔데이터 대조"를 표준으로.
  - **UI 재스타일 워크플로우엔 메인 세션 컴파일 검증(throwaway-dir `vite build`)이 필수 게이트다** — 워크플로우는 설계상 빌드를 안 하고(dist 즉시 라이브·최종 빌드 1회 규칙), vitest는 테스트 미커버 파일(AdminAnalytics 등)의 구문오류를 놓친다. 이번엔 수정 에이전트가 낸 JSX 구문오류를 오직 컴파일 검증이 잡았다(fixture-pass-live-fail의 빌드판). 배포 전 `vite build --outDir <temp>`(서빙 dist 미변경 = 무배포)로 전 파일 컴파일 확인을 DoD에 박을 것 — 특히 리뷰 fix 에이전트가 코드를 만진 경우.
  - (확증) recon-먼저-공유브리프 + 순차 구현은 공유 글로벌 CSS 충돌 0·화면 간 일관성 확보로 이번에도 적중(1~3/5 "파일 접촉면 기준 병렬성" 교훈 4연속 재확인).
  - (확증) 색 토큰 신설 시 실측 대비 렌즈가 유효(`--data-5` 4.2:1 기각 → `--tag-etf-*`, guru-avatar 라이트 대비 3.24:1 포착·수정). 1/5·3/5 교훈 유지.

- 열린 follow-up:
  - **ui/Button.css 다크 하드코딩 hex**(`#2f6ce0`/`#3a6bd6`/`#e4142f`) 토큰화 — 1/5·3/5·4/5 연속 이월(프리미티브 파일이라 어느 슬라이스든 전역 영향, 한 곳에서만). **5/5 흡수 유력**.
  - **StockModal/PromoteModal raw input → ui/Input** — 1/5·3/5·4/5 연속 이월(전역 공유 모달, 4/5 화면 스코프 경계 밖). 5/5나 별도 quick 후보.
  - **Compare 표 모바일 스크롤 실확인** — 이번 스모크는 종목 미선택(0/4) picker 상태만 캡처. `.tbl-wrap table-mobile-wrap` 병기 수정의 실효는 종목 2+ 선택 후 표가 뜬 상태로 5/5 감사에서 확인 권장.

## Doc updates

- CONTEXT.md promotion: none (dead-CSS 재사용 전제 확인·컴파일 게이트·순차구현 — 전부 프로세스 학습, 신규 도메인 용어 아님).
- ADR added: none (디자인 방향은 ADR-0025에 기록됨, 이번은 그 실행 4/5. AA·구문오류 수정은 결정이 아닌 버그픽스).
