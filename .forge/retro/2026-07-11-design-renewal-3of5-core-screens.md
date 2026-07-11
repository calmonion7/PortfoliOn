# 2026-07-11 — 디자인 리뉴얼 3/5: 핵심 화면 정보구조 (task#173)

## Plan vs actual

- What went as planned: S1(리포트 목록/사이드바)·S2(리포트 상세 4탭)·S3(포트폴리오 대시보드+분석) 전부 MET. Dynamic Workflow(7 에이전트, eco 모드 — 전 서브에이전트 sonnet+ECO.md)로 인라인 style을 기존 프리미티브(MarketBadge·ChangeBadge·mono/tnum·filter-chip)·토큰으로 수렴(diff +165/−183 순삭제). 불변식 전량 보존(대시보드 N=N·Skeleton·is_mine 게이트·peer 칩·hasRsi 분기·KR 가격색), 회귀 리뷰 렌즈 결함 0, vitest 69 green, 라이브 스모크(다크+라이트×PC/모바일) 통과. "중간 빌드 금지"(dist 즉시 라이브) 하드 규칙 준수 — 빌드는 메인 세션 최종 1회.
- Divergences (경미, 전부 실행 재량/리뷰 포착):
  - **(in-run 수정) 다크 `--up-soft` price-gain 배지 AA 대비 미달** — 색/대비 리뷰 렌즈가 실측 계산으로 포착: 1/5(task#171)에서 리튠된 다크 `--up-soft`(alpha 0.16) 위 `.badge--success` 대비 4.06~4.37:1(AA 4.5 미달). Fix 에이전트가 alpha 0.16→0.07로 수정(재계산 4.52~4.87:1 통과). **1/5 잔존 결함을 3/5 소비처 리뷰가 잡은 것** — 1/5는 --text-faint·다크 액센트 흰텍스트만 고쳤고 배지 배경 대비는 슬립.
  - **스코프 경계** — 플랜 Non-goals("2/5 골격 위에서 화면 내부만")가 2/5 회고 follow-up("util-bar·ResearchShell PC 헤더는 3/5 재스타일 대상")과 표면상 충돌. 실제론 follow-up이 인가한 범위라 util-bar backdrop-filter 제거를 정당하게 수행.
  - ResearchShell.jsx page-sub 브레드크럼 추가(슬라이스 완료기준 밖 소폭 UI, 기존 데이터 파생·신규 fetch 0).
  - 플랜 문구 stale — "분석 3하위탭" vs 실제 5탭(리밸런싱·노출 이후 추가). diff가 5개 전부 커버(상위집합, 축소 아님).

## Learnings

- Do differently next time:
  - **스타일 담체(전용 CSS vs 공유 글로벌)를 recon에서 먼저 판정해 병렬성을 결정하라** — 이 프로젝트는 스타일 대부분이 공유 글로벌 CSS(App.css·pc.css·mobile.css)+인라인에 산다. 화면별 병렬 구현 에이전트는 같은 글로벌 CSS를 동시 편집해 충돌한다. 리포트→포트폴리오 **순차** 배치가 충돌 0·일관성 확보로 적중(2/5 "같은 파일 여럿이 만지면 단일 에이전트로" 교훈의 CSS판 재확증). 워크플로우 설계 시 슬라이스 경계가 아니라 **파일 접촉면(특히 공유 CSS)**으로 병렬성 판단 — 남은 4/5도 market/ 섹션 다수가 공유 CSS면 동일 적용.
  - **전역 토큰을 만드는 토대 슬라이스의 대비 결함은 소비처 리뷰에서야 드러난다 — 색/토큰 슬라이스엔 실측 대비 렌즈를 표준으로, 전역 토큰 변경 시 전 소비처 대비를 즉시 훑어라** — 1/5가 리튠한 `--up-soft`의 배지 대비 미달이 3/5의 ChangeBadge 소비처 리뷰에서야 포착됐다(1/5 회고 "색 토큰 슬라이스엔 대비 렌즈 표준" 교훈의 유효성 재확증 + 전역 토큰은 소비처가 흩어져 있어 토대 단계 검증만으론 부족). 5/5 최종 감사가 이 전 소비처 스윕의 자연스러운 정착지.
  - **상속된 follow-up이 plan Non-goals와 모순될 수 있으니 계획 단계에서 reconcile하라** — 2/5 회고가 util-bar를 3/5 대상으로 넘겼는데 3/5 플랜 Non-goals는 "골격 밖"이라 적었다. 다행히 recon 프롬프트가 follow-up을 명시해 올바르게 처리됐으나(운 아님), 계획 작성 시 직전 회고의 follow-up을 Non-goals와 대조해 문구 충돌을 없앨 것(1/5 "하드스코프↔슬라이스 목표 충돌 교차확인" 교훈의 회고-계승판).
- 열린 follow-up:
  - `--up-soft` alpha 대폭 하향(0.16→0.07)의 시각 적정성 — price-up 배지 배경이 전 화면에서 훨씬 옅어짐(붉은 텍스트+거의 투명). 터미널 다크 미학엔 부합하나 5/5 최종 감사(양 테마×PC/모바일)에서 재확인.
  - 다크 Button.css 하드코딩 hex(`#2f6ce0`/`#3a6bd6`/`#e4142f`, low·AA 통과·eco 주석) → 토큰화 — 4/5나 5/5 흡수 후보.
  - (1/5 승계) StockModal/PromoteModal raw input → ui/Input 프리미티브 — 이번 미착수(전역 공유 모달, 스코프 밖), 4/5 후보.

## Doc updates

- CONTEXT.md promotion: none (순차구현·대비렌즈·스코프 reconcile — 전부 프로세스 학습, 신규 도메인 용어 아님).
- ADR added: none (방향 결정은 ADR-0025에 기록, 이번은 그 실행 3/5. AA 수정은 결정이 아닌 버그픽스).
