# 수주잔고는 DART 원문(document.xml) + Cowork pending으로 수집

> **갱신 (ADR-0003):** "수치는 Cowork가 채운다" 부분은 ADR-0003으로 개정됨 — 유형1(수주상황 표)은 코드가 구조파싱+검산으로 자동 채우고, Cowork는 유형2/4/모호 케이스의 폴백이 된다. document.xml 원문 수집 전략 자체는 유효.

DART OpenAPI에는 수주잔고(수주상황) 전용 구조화 API가 없다(`정기보고서 주요정보`·`재무정보` 어디에도 없음). 수주잔고는 정기보고서 "사업의 내용" 안의 자유 서술/표 항목이며, 회사마다 표현(수주잔고/수주총액/수주잔량)과 형식(문장형 vs 표형)·단위(백만원/억원)가 제각각이다. 그래서 **공시서류원본파일 API(`/api/document.xml`, rcept_no로 ZIP 다운로드 → 압축해제 → UTF-8 디코드)** 로 원문을 받아 "수주" 텍스트 블록만 추출해 `source='pending'`으로 저장하고, 실제 수치는 Claude Cowork(`PUT /api/report/{ticker}/backlog`)가 읽고 채운다.

## Considered Options
- **A. 완전 자동 정규식 파싱** — 건설 문장형("수주잔고는 X백만원")은 잘 뽑히나 조선·방산 표형/다른 표현/단위 혼재에서 깨지기 쉬워 종목별 예외 누적. 기각.
- **B. 하이브리드(채택)** — 원문에서 "수주" 블록만 안정적으로 적재 + 수치는 Cowork가 보완. 형식 변동에 강건, 구현 단순.

## Consequences
- 기존 코드가 호출하던 `/api/index.json`·`/api/document.json`은 **실존하지 않는 엔드포인트**(DART status 101)였다 — 이 때문에 수주잔고는 한 번도 수집된 적이 없었다. document.xml로 교체해 해결.
- document.xml은 건당 ~1MB(ZIP). 주간 배치(backlog_fetch)·종목 단위라 부담은 감당 가능하나, 대량 종목으로 커지면 다운로드/시간 재검토 필요.
- 자동 수치가 없으므로, pending 행은 Cowork가 채우기 전까지 amount=NULL 상태로 남는다(설계상 의도).
