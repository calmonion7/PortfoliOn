# 2026-07-11 — 디자인 리뉴얼 5/5: 최종 UI 감사 + 잔여 수정 (task#175)

## Plan vs actual

- What went as planned:
  - S1~S4 전부 완료. S1 캡처(메인 세션 인라인 de-risk) → S2·S3 Dynamic Workflow(18 에이전트, eco 모드: 전 서브에이전트 sonnet + ECO 규율) → 회귀수정·검증·S4(메인 세션). 68 캡처(전 화면 × 다크/라이트 × PC/모바일, 빈/blank 0) → 원시 30 발견 → dedup 28 = High 9·Medium 8·Low 11 / **fix 14·defer 7·drop 7**. vitest 69·컴파일게이트(throwaway `vite build`) green. 커밋 `bd53aa9` push·Deploy to Production 러너 19s 성공·라이브 교정본(`index-COtp6-rA.js`) 확인.
  - **task#78 감사 인프라·교훈이 그대로 유효**: 캡처 스크립트 재사용, `waitForFunction` 스피너 대기, 캐시 버스트 선행, **빈화면 needs-verification 규약**. 특히 verify-empty가 라이브 API 대조로 **false-critical 7건을 걸러냄**(fullPage 스티칭 MobileNav 겹침·비동기 로딩 레이스·권한 게이팅·캡처 스크립트 버그) — 시각 단독 비평의 "데이터 손실" 과대주장 방지가 재입증됐다.
  - fix 14: 라이트 테마 배지 대비 AA 미달 다수(토큰 다크닝으로 근본 수정), F13 모바일 국채 4카드 2×2 wrap, F22 순매도 색 반전(빨강→주황), F08 US 목표가 콤마, **이월 Button.css 하드코딩 hex→토큰 승격(1/5·3/5·4/5 연속 이월 해소)**.

- Divergences (전부 실행 재량/리뷰 포착):
  - **⚠️ 가장 중요 — 워크플로우 fix-agent가 `npm run build`를 실제 `frontend/dist`에 실행해 회귀 포함 중간본이 조기 라이브됐다**(`index-V6zqzDZp.js`). nginx가 dist 직접 서빙이라 즉시 라이브. task#174 교훈 "빌드는 메인 세션 최종 1회"가 **메인 세션엔 지켜졌으나 서브에이전트 프롬프트엔 명시 안 돼** 서브에이전트가 위반. → 메인 세션이 회귀 2건 수정 후 최종 빌드(`index-COtp6-rA.js`)로 remediate, 라이브 교정 확인.
  - **적대적 리뷰가 fix-agent 회귀 2건 포착 → 메인 세션 수정**(task#174 패턴 재현): ① F24 설정 시장필터 `.seg`(모바일 전용 width:100% 필)를 PC에도 무조건 적용해 데스크톱서 3버튼 전폭 스트레치 → `seg--compact` 모디파이어(콘텐츠폭). ② F23 헤더 그룹라벨 '일정·인컴'을 모바일 `<h1>`에도 적용했으나 하단 MobileNav·서브내비는 '리서치'라 모바일서 상단↔하단 불일치 → 모바일은 '리서치' 유지·PC만 '일정·인컴'(뷰포트별 네비 컨텍스트에 맞춤).
  - **F22 `--semantic-sell` blast radius**: 재색상(빨강→주황)이 InsiderBadge 외 15+ 소비처(ConsensusChart·StockCard S바·RSI 임계 라벨·weatherAccent 등)에 파급. 재색상 방향은 코드 주석 원의도('순매도=주황') + KR 색 관례(의미 배지 ≠ 가격색)와 일치해 정당(sell이 --up 빨강과 동일색이던 잠재 반전버그 수정). 다만 라이트서 warn(올리브)↔sell(적갈) 색 근접 → caution↔sell 구분력 약화(Low 후속).
  - **F14 스코프 밖 스킵(정당)**: '한국 수출' 빈 스켈레톤은 프론트 결함 아니라 백엔드 kr-exports가 성공 후 인메모리 캐시 미충전으로 매 요청 라이브 재조회(3.75~7초) → 백엔드 후속 과제로 분리.
  - **표시계층 규칙 플래그(정당)**: BatchHub `isMobile` prop 제거는 F24 수정으로 unused가 된 orphan 정리(CLAUDE.md 규칙) — 데이터/API/훅 무영향.
  - S1 리포트 상세: test 계정 report-item 다수가 미생성(비admin) 또는 ETF라 일반주 4탭 강제 캡처 실패, 요약+지표만 확보. 상세 4탭 내부는 task#173(3/5)에서 전담 감사됨 — 신규 리스크 아님.

## Learnings

- Do differently next time:
  - **UI 재스타일/수정 워크플로우의 fix·review 서브에이전트 프롬프트에 "`npm run build`·`frontend/dist` 쓰기 금지, 컴파일 검증은 throwaway `--outDir`로만" 표준 문구를 넣어라** — nginx가 dist 직접 서빙이라 서브에이전트의 검증용 빌드가 곧 배포다. task#174 "빌드는 메인 세션 최종 1회" 교훈은 메인 세션만 다뤘고 서브에이전트 경로가 뚫려 있어 회귀 포함 중간본이 조기 라이브됐다. 워크플로우 스크립트의 fix/review agent 프롬프트에 명시 필수.
  - **자율/배포 전 시각검증은 "로컬 preview + prod API 베이크" 무배포 기법으로** — `VITE_API_BASE_URL=<prod> npx vite build --outDir <throwaway>` → `npx vite preview --outDir <throwaway> --port 5173`(5173은 prod CORS 허용 오리진) → Playwright가 localhost:5173 페이지 캡처, /api는 prod 실데이터. **라이브 dist·배포를 건드리지 않고** 수정본을 실데이터로 검증한다. 이번에 32컷으로 fix 14 + 회귀수정 2를 배포 전 확인. 라이브 dist를 절대 덮지 않아 자율 상황에 안전.
  - **공유 클래스(특히 모바일 전용)를 다른 뷰포트에 재사용할 땐 폭/오버플로 전제를 배선 전에 대조하라** — F24 `.seg`(모바일 width:100%+flex:1)를 PC에 그대로 써 전폭 스트레치. 4/5 "dead-CSS 재사용 시 구조 전제(그리드 열·overflow) 대조" 교훈의 반복. 유일/신규 소비처면 모디파이어로 제약(`seg--compact`), 공유면 해당 화면만 오버라이드.
  - **부분 리네이밍은 새 불일치를 만든다 — IA 라벨은 뷰포트별 네비 컨텍스트에 맞춰라** — F23: PC 사이드바 5섹션(일정·인컴)에 맞춰 헤더를 바꿨으나 모바일 MobileNav·서브내비는 7탭을 '리서치'로 묶은 채라 모바일서 상단↔하단 라벨 충돌(변경 전보다 나빠짐). PC=일정·인컴/모바일=리서치로 분기하고 모바일 5섹션 IA 재정리는 후속으로 명시 분리.
  - **공유 토큰 재색상은 전 소비처 blast radius를 훑어라** — F22 `--semantic-sell` 하나 바꿔 15+ 소비처가 동시에 바뀜. 의미 반전 수정은 옳지만, 인접 의미색(warn)과의 구분력까지 재캡처로 확인할 것.
  - (확증) **verify-empty 라이브 대조 규약**(task#78 교훈 3)이 false-critical 7건을 걸러내 유효성 재입증. (확증) **적대적 리뷰 렌즈**가 fix-agent 회귀 2건을 포착(task#174 조건부 리뷰 가치 재확인) — UI 수정 워크플로우에 리뷰 단계 표준 유지.

- 열린 follow-up:
  - **deferred 7건 (디자인 판단 필요, backlog 후보)**: F04(목표가 배지 문법 리포트열↔추천카드 통일?), F05(즐겨찾기 별 파랑↔KR하락색 겹침→gold?), F19(모바일 로그인 label 생략 의도?), F25(RSI 시각언어 리포트↔포트폴리오 통일?), F26('해당없음' 배지 극저대비 — WCAG 비활성 면제 여지), F27(수급지표 탭 빈 여백), F28(페이지 헤더 1줄↔2줄 통일?).
  - **F14 백엔드 후속**: kr-exports 엔드포인트 `_fetch_and_save_kr_exports` 성공 시 `_set_cache` 미충전 → 매 요청 동기 재조회(3.75~7초). 인메모리 TTL 캐시 충전 또는 staleness 완화.
  - **모바일 5섹션 IA 재정리**(F23 후속): MobileNav·서브내비를 사이드바 5섹션(일정·인컴 분리)에 맞추기.
  - **F22 warn↔sell 라이트 색 근접**(Low 심미): caution↔sell 구분력 재조정 검토.

## Doc updates

- CONTEXT.md promotion: none (신규 도메인 용어 없음 — 전부 프로세스/확증 학습).
- ADR added: none (디자인 방향은 ADR-0025에 기록됨, 이번은 그 실행 5/5 완결. AA·회귀 수정은 결정이 아닌 버그픽스).
- 비고: '워크플로우 서브에이전트 빌드 금지'·'로컬 preview 무배포 검증' 2건은 재사용성 높은 UAT/워크플로우-저작 기법이라 프로젝트 auto-memory(reference-frontend-uat)에도 반영.
