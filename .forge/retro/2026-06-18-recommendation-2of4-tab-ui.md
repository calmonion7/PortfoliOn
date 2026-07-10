<!-- forge-slug: recommendation-2of4-tab-ui -->
# 2026-06-18 — 추천 탭 UI: 발굴 카드 + 딥다이브(관심추가) (task#65, part 2/4)

## Plan vs actual
- What went as planned: 4슬라이스 전부 충족. Dynamic Workflow(3 에이전트, ~168k 토큰, 4분) — 구현 병렬 2(추천 페이지+배선 ‖ README) + 적대적 리뷰(high effort) 1. `Recommendations.jsx` 신설 + `Research.jsx` 수술적 배선(import 1+탭버튼 2+렌더 2) + README 화면 절 1행. 빌드 통과(723 modules), critical/major 0. 커밋 303ab438 push → 라이브. 색 트랩(b288f494/ADR-0015) 회피: 플래그 칩에 가격토큰(success/danger) 미사용, FLAG_STYLE로 kind별 전용색(value=블루/momentum=주황/smart_money=초록/missing=회색).
- 라이브 UAT(직접): ① API 스모크 — test 계정 로그인→`menu_permissions`에 research 확인→`GET /api/recommendations` 50건·점수 내림차순·flags={kind,label}·KR/US 둘 다→watchlist 왕복(POST 201 추가→확인→DELETE 복원)으로 S3 백엔드 경로. ② Playwright(시스템 Chrome CDP+localStorage 토큰 주입, localhost:80 프로덕션 nginx) — '추천' 탭 1개·클릭 후 딥다이브 버튼 50개 가시·카드(종목·점수·시장배지·플래그칩) 시각 확인. verified: yes.
- Divergences:
  - **TDD-on이나 프론트 단위 테스트 하니스 없음(vitest/jest 미설치) → live-UAT-as-test**(사전 surface한 계획적 divergence). 하니스 신설은 UI 파트 범위 밖(Simplicity). 검증=빌드+라이브 UAT(part1 회고의 "코드/빌드 + 라이브 UAT 분리" 연장). 단위 테스트 미작성.
  - **사전 Explore 맵이 flags를 `string[]`로 오기** — 실제 백엔드(`derive_flags`)는 `{label,kind}[]` 객체. 구현자가 backend grep으로 확인하고 `flag.kind`(색)·`flag.label`(표시)로 정확히 구현. 영향 없음.
  - **trackEvent 생략** — `events.py` `VALID_EVENTS`에 `tab_recommendations`·딥다이브 이벤트 없어 새 탭/버튼은 추적 생략(백엔드 무변경 Non-goal 준수). 기존 4탭은 그대로.
  - 리뷰 minor 3(비차단): 딥다이브 `exchange='KS'` 하드코딩(추천 응답에 exchange 필드 없음·Ranking도 동일 폴백·KOSDAQ 오표시 가능), 색 우연 충돌(smart_money 초록=market-kr 초록·실전 미충돌), LoadingSpinner 중복 style.

## Learnings
- Do differently next time:
  - **응답 스키마는 사전 맵/계획이 아니라 백엔드 코드로 확정** — 이번에 Explore 맵이 flags 타입을 틀렸고, 다행히 구현자가 grep으로 잡았다. part 3/4(watchlist 섹션)·4/4(holdings 섹션)는 응답 shape를 additive로 다루므로, 워크플로우 프롬프트에 "응답형은 `recommendations.py`/`recommendation/store.py`를 직접 읽어 확정"을 명시할 것(맵 인용은 출발점일 뿐).
  - **발굴 카드를 공유 컴포넌트로 추출하면 part 3/4·4/4 재사용이 쉬워진다** — 현재 `Recommendations.jsx`의 카드 마크업은 한 파일 내 인라인(map 콜백)이다. part 3/4·4/4가 "발굴 카드 컴포넌트 재사용"을 계획에 명시하므로, 3/4 시작 시 카드를 `RecCard`류 공유 컴포넌트(+점수/플래그 칩 렌더)로 추출하면 관심·보유 섹션이 그대로 쓸 수 있다. FLAG_STYLE(kind별 전용색) 템플릿도 4/4 액션 배지(추매/익절/홀딩, 가격토큰 금지)에 그대로 확장.
  - **프론트 UI 라이브 UAT 레시피(재사용)** — 프론트 단위 하니스가 없어도 무UI 단계에서 검증 가능: ① 시스템 Chrome을 `--remote-debugging-port`+`--headless=new`로 띄워 playwright `connectOverCDP('http://127.0.0.1:PORT')`(localhost는 ::1로 풀려 ECONNREFUSED — 127.0.0.1 고정), ② localhost:80(프로덕션 nginx, dev 5173 아님)으로 goto 후 `localStorage.access_token` 주입+재방문으로 로그인 UI 우회, ③ "가시 요소 대기"(`waitFor visible`) 후 캡처(스피너 순간 회피). API 스모크는 test 계정 로그인→Bearer로 엔드포인트 직접 호출.
- 관찰(후속 후보, 차단 아님):
  - **딥다이브 exchange 정확도** — 추천 응답에 exchange가 없어 KR을 'KS'로 폴백. KOSDAQ 딥다이브 시 watchlist에 exchange='KS' 박혀 MarketBadge KOSPI 오표시·yfinance 폴백 심볼 .KS 오류(주경로 키움/KIS/Naver는 6자리라 무영향). 후속: 추천 store/응답에 exchange additive 노출, 또는 watchlist POST가 KR 미지정 시 `tickers` 마스터에서 보강.
  - part1 미해결 관찰 여전: 발굴 상위 저유동성 OTC 혼입(CFRHF/HKHHF 이번에도 1·3위)·미추적 종목 value(목표가) 결측 편향(상위 다수 '목표가 데이터 부족'). 유동성/주거래소 필터 + 미추적 value 보강이 발굴 품질 튜닝 후속.
- 검증 게이트: 빌드 통과 + 적대적 리뷰 0(critical/major) + API 스모크(50건 점수순·watchlist 왕복) + Playwright 시각(탭·50카드·색 트랩 회피)로 verified: yes. 커밋 303ab438.

## Doc updates
- CONTEXT.md promotion: none (추천·발굴 유니버스·딥다이브는 ADR-0015/part1에서 이미 정의, flag kind enum은 구현 디테일).
- ADR added: none (색 토큰 규칙·additive 소비·딥다이브=관심추가 위임 모두 ADR-0015 기존 결정 범위 — ADR 3조건 미충족).
- 메모리: `reference-frontend-uat`에 토큰 주입+localhost:80 CDP UI UAT 레시피 추가 예정(별도 메모리 시스템).
