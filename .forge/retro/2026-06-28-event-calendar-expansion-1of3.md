<!-- forge-slug: event-calendar-expansion-1of3 -->
# 2026-06-28 — 이벤트 캘린더 확장 1/3 (US 배당락일 + 경제지표 일정) (task#119, part 1/3)

## Plan vs actual
- **계획대로**: 3슬라이스 전달. S1 배당 이벤트를 `t.calendar["Ex-Dividend Date"]` 확정 ex-date로 교체(추정 폐기, US; KR 비대상). S2 `econ` 이벤트를 FRED `/releases/dates` curated셋(CPI·고용·GDP·PPI)으로 market-wide 1회 병합, 무키 graceful. S3 프론트 `Calendar.jsx` econ 타입(기존 `--warn` 토큰 재사용)·README·API_SPEC. eco 체크 +8테스트 green(pytest 939), `npm run build` ✓. 커밋 `ab7fa947` 푸시·배포.
- **eco 리팩터**: `t.calendar`를 `_fetch_stock`서 1회 fetch해 earnings·dividend 공유(시그니처 t→cal). 중복 제거·무회귀.
- **워크플로**: 백엔드 단일 에이전트(calendar.py 공유 — [[reports-jsx-presentational-split]] 교훈)·프론트/문서 병렬·Review.

## Divergences
- **D4 (INFO, 기존 버그를 S2가 악화·미수정 → 후속)**: `main.py` `_warm_calendar_cache`가 **죽은 file-exists 가드**(DB 마이그레이션 후 그 파일 미사용)로 **매 기동 재실행** + `user_id=''`라 **캐시 저장도 안 함**(순수 낭비). S2가 `_get_econ_events`를 `_get_events`에 추가하며 `FRED_API_KEY` 설정 시(prod) **매 백엔드 기동마다 라이브 FRED 호출 1회** 발생 — "외부 API를 기동 경로서 라이브 호출 말 것" gotcha 위반. graceful(1콜·실패안전)이라 비치명적이나, surgical 원칙으로 이번 미수정 → **fg-quick 후속**(warm 가드 DB 확인 또는 empty-portfolio warm서 econ 스킵).
- **D1 (계획→실제)**: FOMC 제외 — FRED `/releases/dates`는 FOMC 회의일 미포함(위원회 이벤트, 데이터 릴리스 아님). 정적 FOMC는 YAGNI 보류 → **후속 권장**(최고가치 매크로).
- **D2 (스코프, 의도)**: KR 배당락일 제거 — 전망 ex-date 불가(`005930.KS`도 t.calendar에 Ex-Dividend Date 없음). 계획 non-goal대로.
- **③ 검증 deferred**: 로컬 무키 → econ `[]`만 확인, 실제 populate는 배포 후(prod 키).

## Learnings
- **Do differently next time**:
  - **request-time 뷰에 외부 호출을 추가할 땐 *모든* 호출 경로를 점검하라 — 특히 startup-warm.** "request-time-on-cache-miss라 기동엔 무관"이란 가정이, 죽은 가드로 매 기동 도는 `_warm_calendar_cache`가 같은 `_get_events`를 호출하는 바람에 깨졌다(D4). 외부 호출을 view 함수에 넣기 전 `grep`으로 그 함수의 startup/warm 호출자를 확인할 것(CLAUDE.md "기동 경로 외부호출 금지" 원칙의 *적용 누락* 사례).
  - **죽은 캐시-warm은 외부 호출을 끼우면 낭비에서 footgun으로 승격**한다 — 효과 없는(저장도 안 하는) warm을 발견하면 외부 의존을 늘리기 전에 먼저 정리하거나 가드할 것.
  - **외부 "기존 소스 재사용"은 키만 사실일 수 있다** — FRED 키는 있었지만 `/releases/dates`는 FOMC를 안 줘 일부 목표가 소스 부재. 그릴링서 소스 *모양*까지 확인했어도 라이브 응답 필드는 또 다를 수 있음(이번엔 그릴링이 잘 잡아 part로 분리).

## Doc updates
- CONTEXT.md promotion: none (econ/배당락 = 일반 개념).
- ADR added: none (캘린더 이벤트 additive — 기존 request-time-cached 패턴 내; D4는 버그 후속이지 결정 아님).
- CLAUDE.md: none — "기동 외부호출 금지" 원칙 이미 존재, `_warm` 깨진 상태는 곧 고칠 후속이라 gotcha 박으면 stale.
- **후속 태스크 후보**: (1) fg-quick — `_warm_calendar_cache` 가드 수정/econ 기동스킵(D4), (2) FOMC 정적 일정 추가(D1).
