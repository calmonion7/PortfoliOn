# ADR-0028 — 이벤트 구동 분석 파이프라인: 배치 완료 → Claude Code 루틴 fire

- 상태: 채택 (2026-07-25 당일 개정 — 실행 주체를 클라우드 루틴 → **로컬 headless `claude -p` 리스너**로 교체, 아래 개정 노트)
- 날짜: 2026-07-25
- 관련: task#213, ADR-0027(개정 — 발행 자동화 허용), CLAUDE_COWORK_API.md

> **개정 노트 (2026-07-25, 같은 날 fix-forward)**: 클라우드 루틴을 생성·발사해 본 결과 **Anthropic 클라우드 샌드박스가 외부 네트워크(portfolion.taebro.com)에 도달하지 못함이 실측 확인**됨(3회 발사 모두 서버 로그 무흔적, health-only 진단 런 포함). 이에 기각했던 "로컬 headless" 안을 승격: **호스트 로컬 리스너(launchd 데몬, 127.0.0.1) → `claude -p`(구독 OAuth)** 가 실행 주체다. 백엔드 fire 훅(§2)은 전송처만 로컬 URL로 바뀌고 무변. 부수 개선: 쓰기 키(COWORK_API_KEY)가 클라우드에 상주하지 않고(§4 트레이드오프 해소), fire 토큰도 자체 발급(claude.ai UI 단계 불필요). launchd keychain footgun(HOME/USER/LOGNAME 필수)은 전역 플레이북 해법 적용. 정책 프롬프트는 레포 파일(`scripts/cowork-routine-prompt.md`)로 버전관리 — 박제본 드리프트도 완화. 클라우드 루틴(trig_0112BqEaa8D9ZGXaZ5JCcQpj)은 비활성 보존(egress 정책이 열리면 재검토).

## 맥락

AI 분석(enrich 필드·애널리스트 리포트 발행)은 외부 Cowork 클라이언트가 수동 세션으로 API를 호출해 수행해 왔다(백엔드 무LLM 원칙). 사용자는 이를 자동화하길 원하지만 **Anthropic API(토큰 과금) 계정을 쓸 수 없는 상황**이라, 백엔드가 직접 LLM을 호출하는 길은 애초에 없다. Claude Code **루틴(claude.ai 구독 기반 클라우드 에이전트)**이 cron 외에 **API 트리거(fire — HTTP POST)**를 지원함이 확인되어, "스케줄은 포트폴리온이 소유하고, 이벤트 발생 즉시 Claude가 분석을 수행해 API로 써넣는" 플로우가 가능해졌다.

## 결정

1. **실행 주체 = claude.ai 루틴** (사용자 구독으로 실행, API 계정 불필요). 루틴 프롬프트에 CLAUDE_COWORK_API.md 워크플로우 + 정책 + 포트폴리온 쓰기 키(COWORK_API_KEY)를 탑재한다.
2. **스케줄 소유 = 포트폴리온**: `_generate_all`(daily_report_kr/us) 완료 직후 시장 컨텍스트를 담아 **best-effort fire**(실패는 로깅만 — 배치 본문을 깨뜨리지 않음) + admin 수동 fire 엔드포인트. fire용 트리거 토큰은 `backend/.env.docker` 보관, env 미설정 시 휴면(dormant-safe).
3. **자동 경로 정책(비용·품질 가드레일, 루틴 프롬프트에 명시)**:
   - enrich: enriched_at 누락·오래된 순 **rolling 최대 5종목/회** (전 종목 매회 재작성 금지 — 자연 순환)
   - 애널리스트 리포트 발행: **루틴 재량 + 가드레일** — 보유 종목 중 최신 발행 7일+ 경과 또는 유의미한 변화(실적 발표·컨센서스 급변) 종목만, **회당 최대 2종목**
4. **쓰기 키의 클라우드 상주 수용**: COWORK_API_KEY가 루틴 설정에 들어간다. 유출 시 피해 = 분석 필드 쓰기 수준(계정·결제 접근 불가), 키 교체로 즉시 무효화 가능 — 사용자 명시 수용.

## 근거

- **Anthropic API 직접 호출** 기각: API 계정 불가 + 백엔드 무LLM 원칙(anthropic 의존성 없음) 유지. fire는 HTTP POST 1개라 원칙과 충돌하지 않는다.
- **로컬 headless(`claude -p`) 이벤트 소비자** 기각: 상시 리스너 데몬이 필요하고 launchd 최소환경 keychain 인증 무음 실패 footgun(전역 CLAUDE.md 문서화)을 밟는 경로 — 클라우드 루틴이 더 단순.
- **Cowork 수동 유지** 기각: 사용자가 자동화를 원함. 기존 "발행 온디맨드 전용"(ADR-0027)은 원칙이 아니라 자동화 수단 부재의 우회였음이 확인됨 → ADR-0027 개정.

## 결과

- 정기 enrich·발행의 Cowork 수동 세션 의존 소멸. CLAUDE_COWORK_API.md는 폐기가 아니라 **루틴 프롬프트의 소스**로 역할 전환(문서 갱신 규율 유지).
- 루틴 실행 결과의 실시간 콜백 없음(fire-and-forget) — 관측은 enriched_at·발행물 생성 여부로 사후 확인. 재시도 큐 등은 필요해질 때(YAGNI).
- 루틴 프롬프트도 박제본이다 — API 계약이 바뀌면 문서 2종에 더해 **루틴 프롬프트 갱신**이 DoD에 든다(Cowork 스킬 사본 드리프트 가토의 루틴판).

> **개정 (2026-08-04, task#279)**: 트리거 본문(fire의 `text`)은 정책을 열거하지 않는다(정책 정본 = 프롬프트 파일). 열거하면 프롬프트의 '트리거 우선' 규칙에 따라 stale 목록이 정본을 이긴다 — task#279에서 선도기술 리포트가 이 경로로 0건이었다.
