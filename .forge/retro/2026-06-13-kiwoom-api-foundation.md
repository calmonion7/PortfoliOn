# 2026-06-13 — 키움 REST API 토대 + 카탈로그 + KR 현재가 첫 대체 (Phase 1/3)

## Plan vs actual
- What went as planned: 5개 슬라이스(클라이언트 토대 · ka10001 정규화+테스트 · get_quote_kr 키움우선+Naver폴백 · KIWOOM_API.md 207 TR 카탈로그 · env 배선) 계획대로 구현. public REST 엔드포인트 무변경이라 API_SPEC/COWORK 갱신 불필요(계획대로). 전체 475 테스트 통과. main ac4b0459 배포·/health 정상.
- Divergences: **낮음.** (1) 계획이 S1 리스크로 잡았던 "키움 개발자포털 IP등록/사용신청 필요 가능성"이 **미발생** — 발급된 appkey/secretkey로 즉시 토큰 발급(긍정 divergence). (2) 정규화 검증 중 삼성전자 cur_prc ₩322,500·시총 1,885조가 stale 지식(~₩70k)과 4.6배 차이나 단위버그로 오판할 뻔 → 계획에 없던 "현직 소스(Naver) 동시점 교차검증" 단계를 추가해 false alarm 확인. 사소: 카탈로그 표는 기능 TR 207개 + 오류코드 섹션(원본 208행째).

## Learnings
- Do differently next time:
  - **키움 토큰 발급은 마찰 없음** — Phase 2/3에서 새 TR을 붙일 때 인증 셋업을 다시 의심할 필요 없다. 토큰 싱글톤(12h 캐시 + 401 재발급 재시도)이 그대로 재사용된다. 새 TR은 `client.request(api_id, body, category)`에 `api-id`/`category`(URL 끝)만 맞추면 됨.
  - **외부 데이터 타당성은 stale 지식이 아니라 "기존/현직 소스와 동시점 교차검증"으로 판정** — 시세·시총처럼 시간에 따라 크게 변하는 값은 내 훈련지식과 어긋나도 버그가 아닐 수 있다. 새 소스 도입 시 같은 시점 incumbent 소스와 1:1 대조가 단위/부호 버그와 stale 오판을 동시에 거른다(키움↔Naver byte 일치로 mac 억원→원·cur_prc 절대값 정규화 정확 확인). Phase 2(차트/수급/랭킹) 대체 시에도 동일 교차검증 권장.
  - **키움 응답값은 부호 포함 문자열 + 금액 단위 제각각**(시총 억원, 가격 부호 포함) — 새 TR 정규화마다 단위/부호 fixture 단위테스트를 먼저 둘 것(수주잔고 ×100 오저장 교훈과 같은 결).

## Doc updates
- CONTEXT.md promotion: none (용어 「키움 시세 소스」는 fg-ask 그릴링에서 이미 추가)
- ADR added: none (경계 결정은 fg-ask에서 ADR-0009로 이미 기록)
