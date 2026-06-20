# 2026-06-20 — KR 색 관례 위반 일괄 교정 + 시맨틱 토큰화 (task#79)

> task#78 UI/UX 진단이 자동 분해한 fix 클러스터 6건(#79~84) 중 하나. 커밋 8a3e3ef8.

## Plan vs actual
- What went as planned:
  - S1~S4 전부 완료. `tokens.css` 라이트(`:root`)+다크(`[data-theme="dark"]`)에 시맨틱 토큰군(`--color-success/error/info`, `--semantic-buy/sell`, `--corr-pos/neg/zero`, WCAG 4.5:1) 신설. 가격방향(`--up`/`--down`) vs 의미상태(시맨틱 토큰) 전수 분리. VIX·HY 등 invert 지표는 `changeInverted` 분기 구조 유지하고 hex만 토큰화. 상관 히트맵 중립 발산 팔레트(`--corr-*`)+범례. grep: 가격/의미 경로 잔여 서양식 hex 0건.
- Divergences:
  - **초안 영향파일 23 → 실제 48파일**. 자동 분해 stub 플랜의 영향파일은 "초안"이라 실제 스프레드(차트 시리즈색·pc/mobile.css·HistoryTab·ConsensusChart·InsiderTrades 등)가 훨씬 넓었다. 파일을 겹치지 않는 6그룹으로 파티션(각 파일 단일 소유)해 9에이전트 병렬 충돌 0으로 처리.
  - **다크 셀렉터**: 플랜은 `.dark`로 표기했으나 실제는 `[data-theme="dark"]` — 실제 셀렉터로 적용.
  - **적대리뷰 critical 1건**: InsiderTradesSection 내부자 지분증감(매수/매도 신호)이 가격토큰(`--up/--down`)으로 오분류 → 형제 InsiderBadge와 동일하게 `--semantic-buy/sell`로 교정. **이 작업이 막으려던 바로 그 실패모드가 작업 중에 한 번 더 발생**한 셈.
  - 미그릴링 stub이라 의미색 값(success/buy=초록, error/sell=빨강계, info=파랑, 상관=teal/amber)을 SupplyBadge·`--warn`·tag 토큰 선례에 정렬해 자체 결정.

## Learnings
- Do differently next time:
  - **자동 분해 stub 플랜의 "영향파일 초안"은 하한으로 취급** — 색·토큰처럼 앱 전반에 흩어진 변경은 실제 스프레드가 2배 이상일 수 있다. 파일 단위 단일소유 파티션이 병렬 충돌을 0으로 막는 데 유효.
  - **가격방향 vs 의미상태 혼동은 이 코드베이스의 구조적 재발 함정** — 신규 색 코드는 "이게 가격 오름/내림인가, 아니면 매수/성공/경고 같은 의미인가"를 먼저 분류하고 토큰을 골라야 한다(CONCERNS #10).
  - 헤드리스 캡처에서 미로딩되는 화면(랭킹·상관·매크로·수급)의 의미색은 grep+적대적 diff 리뷰로 검증(task#78 회고의 슬로우로드/콜드캐시 제약과 동류) — #81·#82 완료 후 재캡처하면 라이브 추가 확인 가능.

## Doc updates
- CONTEXT.md promotion: none (색 토큰은 도메인 용어가 아니라 구현 디테일)
- ADR added: none (되돌리기 쉬운 CSS/토큰 변경)
- 기타: `.forge/codebase/CONCERNS.md` #10에 "체계적 해소(task#79)" 단락 추가 — 시맨틱 토큰군 신설로 의미배지 반전 함정 표면 축소 + 신규 코드 재발 경고(InsiderTrades critical 사례).
