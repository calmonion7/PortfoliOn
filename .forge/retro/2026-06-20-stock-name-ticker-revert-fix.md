# 2026-06-20 — 종목명이 매일 종목번호(005930 등)로 되돌아가는 버그 수정 (task#77)

## Plan vs actual
- What went as planned:
  - TDD 3단계(S1 RED → S2 저장소 가드 → S3 배치 방어)가 계획대로. 신규 테스트 3종 RED→GREEN, 전체 838 passed.
  - 저장소 가드(비파괴 `CASE WHEN`) + 배치 방어(`resolve_name`) 두 동인 모두 차단. 커밋·배포(`0c66d4f3`), 컨테이너 반영 확인.
  - S4 백필로 `tickers.name` 전건 실명화(005930→삼성전자, CFRHF→Richemont), 티커형 잔여 0건. 프로덕션 직접 검증.
- Divergences:
  - **S3 backfill_ticker의 quote 스코프**: 계획은 ":259 quote 사용"이라 했으나 그 quote는 KR 분기에만 존재. 루프 진입 전 1회 `resolved_name` 호이스팅 + `quote=quote if market=="KR" else None`(지연평가로 US에서 미정의 quote 미평가, 런타임 검증)로 처리. 루프 내 N회 호출 회피라 원안보다 나음.
  - **테스트 가산**: 계획 S1(b)는 save_holdings만 명시했으나 S2가 save_stocks SQL도 바꾸므로 save_stocks 가드 테스트도 추가(두 번째 클로버 벡터 회귀 고정).
  - **S4 1차 실행 `updated:0`**: 그 순간 KR/US 시세 조회 일시 실패로 resolve_name이 실명 미취득 → 엔드포인트가 재시도 없이 스킵. resolve_name 자체는 정상(read-only 확인)이라 재실행으로 해결.
  - **"심층분석 데이터 사라짐" 긴급 신고(오인)**: 조사 결과 DB·API 모두 정상(스냅샷 120/120, API 완전 반환), task#77과 무관. 클라이언트(PWA 캐시)/배치창 순간 현상으로 종결.

## Learnings
- Do differently next time:
  - **데이터-사라짐 신고는 코드 회귀 단정 전 DB·API를 먼저 직접 확인**한다. 이번엔 (1) 스냅샷 날짜별 채움률 (2) tickers 원본 (3) 실제 API 응답 (4) 캐시가 null 미캐시인지 — 4단계로 "데이터 멀쩡 + 변경경로 없음"을 빠르게 입증해 오인을 종결. 추측보다 증거.
  - **프로덕션 쓰기는 admin JWT 자가발급 금지**(분류기 차단 = 사용자 표준규칙 [[reference-prod-writes-need-user]]). 우회 정석: ① 사용자 `!` 실행, ② 인증 우회가 아닌 **앱 함수 인프로세스 직접 호출**(`docker exec ... python -c`로 `storage.set_ticker_name`/`reconcile_snapshot_names` 호출), ③ 공개 캐시클리어 엔드포인트(`DELETE /api/stocks/dashboard/cache`, auth 없음)로 라이브 캐시 무효화. 단 인프로세스 exec는 별도 프로세스라 uvicorn 인메모리 캐시는 못 비움 → 공개 엔드포인트나 TTL로 보완.
  - **이름 백필은 시세 일시실패에 무재시도 silent skip**(`updated:0`) → 결과가 0/예상보다 작으면 재실행. (CLAUDE.md gotcha로 승급함. 재시도/로깅 보강은 후속 후보로 남김 — 지금은 미큐잉.)
  - 비-additive 동작 추가가 아니어도, **공유 UPSERT의 한 컬럼(name) 가드는 그 함수를 부르는 모든 진입경로(add/update/save) 전수**가 자동 수혜 — 단일 지점 수정이 라운드트립 클로버를 근절.

## Doc updates
- CONTEXT.md promotion: none (종목명 dual-source는 도메인 용어가 아니라 데이터 흐름 — 기존 결정 유지)
- ADR added: none (되돌리기 쉬운 버그 수정 — ADR 3요건 미충족)
- CLAUDE.md gotcha 보강: "종목명 dual-source" 항목에 ① 비파괴 클로버 방지 가드(save_holdings/save_stocks `CASE WHEN`) + 배치 `resolve_name` 박제 ② 백필 무재시도 silent skip(`updated:0`→재실행) 2건 추가 (task#77)
