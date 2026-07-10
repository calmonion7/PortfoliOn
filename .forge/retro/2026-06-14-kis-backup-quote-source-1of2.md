# 2026-06-14 — KIS 백업 시세 Part 1 (클라이언트 토대 + KR 현재가 폴백)

## Plan vs actual
- What went as planned: 5개 슬라이스(KIS_API.md 카탈로그 · kis/client.py 토대 · kis/quote.py 국내 정규화 · get_quote_kr 체인 삽입 · env/문서 포인터) 계획대로 구현. 정규화 test-first(결정대로) — test_kis_quote.py 먼저, 통과 후 진행. 전체 백엔드 **534 통과**(신규 16). public 엔드포인트 무변경이라 API_SPEC/COWORK 갱신 불요(계획대로). 키 미설정=휴면(configured 가드)으로 dormant-safe 배포(c041ae39).
- Divergences: **낮음.** (1) 커밋 단계에서 **`.forge/codebase/`가 tracked**인 걸 발견 — forge 통념(.forge 전체 gitignored)과 달리 이 repo는 codebase 맵만 추적, 나머지 forge 상태는 untracked. INTEGRATIONS.md 편집을 코드 커밋에 포함해 폴러 `reset --hard` 소실 방지. (2) EGW00133(발급 1분당 1회)는 키움엔 없던 제약 → 계획의 "60s 가드"를 force-reissue 시 직전 60s 내면 기존 토큰 재사용하는 방식으로 구체화.

## Learnings
- Do differently next time:
  - **이 repo의 `.forge/` 추적 상태는 혼합** — `.forge/codebase/*.md`는 **tracked**(폴러 `git reset --hard` 노출), 그 외(plan/run/STATUS/CONTEXT/adr/retro/backlog)는 untracked. 코드베이스 맵을 편집하면 **코드 커밋에 함께 넣어야** 다음 폴(≤2분)에 소실되지 않는다. forge 스킬 통념(".forge gitignored")은 이 repo엔 부분적으로만 참 — codebase 맵 편집 시 주의.
  - **KIS 토큰은 발급 1분당 1회(EGW00133)** — 키움(제한 없음)과 다르다. 401 등 강제 재발급 시 직전 발급 60s 이내면 기존 토큰 재사용으로 방어(토큰 24h 수명이라 60s 내 토큰은 거의 확실히 유효). 인프로세스 싱글톤이라 컨테이너 재시작마다 1회 발급(1/min 내라 안전). Part 2 US TR도 같은 토큰·클라이언트 재사용.
  - **KIS 국내 현재가 TR(FHKST01010100)엔 종목명 없음** — 키움 ka10001(stk_nm 보유)과 차이. 정규화 name=None, 폴백 단계라 `market.resolve_name`이 후처리(빈 이름은 티커 유지). Part 2 US(HHDFS00000300)도 name 빈약 예상 — 정규화 시 동일 처리.
  - **인라인 직접 실행이 직렬 체인엔 적합** — S2→S3→S4→S5가 의존 체인이라 Dynamic Workflow 병렬 이점이 없다. 사용자 선택대로 인라인이 빠르고 단순했다. (워크플로우는 독립 fan-out이 있을 때만.)

## Doc updates
- CONTEXT.md promotion: none (용어 「백업 시세 소스 (KIS)」는 fg-ask 그릴링에서 이미 추가)
- ADR added: none (경계는 fg-ask에서 ADR-0011로 이미 기록)
- 실행 중 갱신(승격 아님): `CLAUDE.md` KIS gotcha 1줄(S5) · `.forge/codebase/INTEGRATIONS.md` KIS 항목(tracked, 커밋됨) · `backend/.env.docker.example` KIS 변수
