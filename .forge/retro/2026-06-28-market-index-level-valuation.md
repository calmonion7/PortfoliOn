# 2026-06-28 — 시장지수 레벨 + US Shiller CAPE (task #113)

## Plan vs actual
- What went as planned: S1~S4 전부 MET. 신규 `indices.py`가 fx 패턴(요청경로 증분·배치 없음)으로 `^GSPC`/`^KS11`/`^KQ11` + S&P500 CAPE를 `GET /api/market/indices`로 서빙, `IndexSection.jsx` 시장지표 탭 최상단, API_SPEC/README 동기·doc-sync 3/3. **multpl 라이브 추출 성공**(CAPE 40.7+통계, GSPC 7354.02). NaN 가드(`math.isfinite`+`sanitize`)·yfinance/CAPE graceful 폴백·`html.parser`. 적대 리뷰 실버그 0. 배포 success 후 라이브 prod GET 200 end-to-end 확인.
- Divergences (경미):
  - **씨앗 전제 오류 — "US 밸류=FRED CAPE 기존"이 틀림**: 그릴링서 라이브 검증 결과 FRED엔 S&P CAPE 시리즈 없음(FRED "Case-Shiller"는 주택가격). multpl.com 크롤로 정정, KR 지수 PER은 후속 분리. (그릴링 단계서 잡아 plan/CONTEXT에 반영 — 실행 발산 아님.)
  - **CLAUDE_COWORK_API.md 미변경(정당)**: DoD는 "양 문서"였으나 COWORK는 enrich 전용이라 market read 엔드포인트 미수록. doc-sync는 API_SPEC만 live-vs-doc 검사라 통과. 일반 DoD의 올바른 예외.
  - **기존 실패 5건 발견(#113 무관)**: `test_financials_kr.py`·`test_financials_kr_cashflow.py`가 `from backend.services...`(잘못된 `backend.` 접두) → `ModuleNotFoundError`. task#111(aba00346)/#117(f1839804)서 유입, HEAD에 이미 존재. #113 자체 테스트(test_indices 4/4)·doc-sync·npm build green.

## Learnings
- Do differently next time:
  - **씨앗(seed) 계획의 데이터소스 전제는 "기존 재사용"이라 써 있어도 그릴링서 라이브 검증할 것** — "FRED CAPE 기존"이 실은 부재였다. 후보 도출 단계의 소스 가정은 미검증 가설로 취급.
  - **keyless 크롤 소스는 워크플로우서 라이브 추출 검증을 시도하라** — 회고 #53(FRED, 키 필요→workflow서 검증 불가)과 달리 multpl은 keyless+네트워크 가능이라 in-workflow 실값 대조가 됐다. keyless면 라이브 1회 대조를 DoD에 넣고 실제로 시도.
  - **follow-up (trivial, fg-quick 적합)**: `test_financials_kr.py`·`test_financials_kr_cashflow.py`의 `from backend.services...` → `from services...` 접두 제거(기존 실패 5건 해소, #113 무관).

## Doc updates
- CONTEXT.md promotion: `[[시장지수 밸류에이션]]` — 그릴링(fg-ask) 단계서 이미 등록(per-종목 밸류·매크로 신호와 구분 + "FRED엔 주식 CAPE 없음" 출처 주의). 이번 회고 신규 승급 없음.
- ADR added: none (데이터소스/요청경로 선택은 기존 fx·매크로 신호 패턴 범위 내 — 3조건 미충족).
- CLAUDE.md: 신규 `indices.py` 서비스 가토 1건 추가(FRED-no-CAPE·multpl 크롤·요청경로 무배치).
