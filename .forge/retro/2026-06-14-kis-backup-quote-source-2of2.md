# 2026-06-14 — KIS 백업 시세 Part 2 (US 현재가 폴백 yfinance→KIS)

## Plan vs actual
- What went as planned: 3개 슬라이스(get_quote_us price+dailyprice EXCD probe · market.py US 분기 KIS 폴백 삽입 · KIS_API.md US ✅+zdiv 노트) 계획대로. 정규화 test-first. 신규 14종, 전체 **548 통과**, 무회귀. 휴면 안전(yfinance 정상 OR 키 미설정이면 미발동)으로 배포(af6a1bd5).
- Divergences: **낮음.** (1) 계획에 없던 **dailyprice 필드 GitHub 타깃 리서치**를 구현 전 삽입 — Part 1 종합 리서치가 dailyprice 필드·zdiv를 미확정으로 남겨서. (2) zdiv 절대 스케일을 repo만으로 단정 못 해 "라이브 교차검증 대기"로 명시(계획의 막연한 "보강"을 구체적 리스크로 승격).

## Learnings
- Do differently next time:
  - **신규 외부 API는 1차 리서치 때 "실제 구현할 TR의 정확한 필드·스케일"까지 확정하라** — Part 1 리서치는 카탈로그·인증·현재가 TR은 잘 잡았지만 dailyprice 필드·zdiv 스케일을 "flagged/미확정"으로 남겨, Part 2에서 타깃 재리서치가 필요했다. 구현할 TR이 정해졌으면 그 TR의 example 파일을 1차에 끝까지 읽는 게 왕복을 줄인다. (단, 미확정을 추측으로 메우지 않고 재확인한 건 옳았음 — 키움 retro 교훈 준수.)
  - **zdiv 같은 "스케일 ambiguity"는 wrong<missing 설계 + 라이브 incumbent 교차검증으로 처리** — 공식 예제가 zdiv 미적용이면 그걸 따르되(소수 가격 간주), 절대 스케일은 코드·문서에 "키 주입 후 yfinance 동시점 대조" 게이트로 못박는다. 잘못된 필드/스케일이 None(graceful)이 되도록 probe를 설계해 ×10^n 대형 오저장(수주잔고·공매도 사례)을 구조적으로 차단.
  - **KIS 해외 현재가도 종목명 없음** — 국내(FHKST01010100)와 동일. `_us_quote_kis`가 ticker 유지, resolve_name 후처리. KIS 폴백 quote는 sector/industry/ytd/시총도 비어 price·prev·일간변동만 — 백업 한정 degrade로 수용.
  - **EXCD probe(힌트 우선 후 NAS→NYS→AMS)** — 우리 exchange 필드가 KIS EXCD와 불일치할 수 있어 순차 probe. 백업 경로(yfinance 죽었을 때만)라 최대 6콜 허용. 1차 소스가 멀쩡하면 비용 0.

## Doc updates
- CONTEXT.md promotion: none (용어 「백업 시세 소스 (KIS)」는 KR=US 공통, Part 1에서 추가됨)
- ADR added: none (US 폴백은 ADR-0011 Consequences에 이미 포함 — overseas price+dailyprice·EXCD probe 명시)
- 실행 중 갱신(승격 아님): `KIS_API.md` US 섹션 ✅ + dailyprice 상세 + zdiv 검증 노트
