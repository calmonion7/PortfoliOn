# 2026-07-05 — 포트폴리오 노출·집중도 대시보드 (통화·섹터·단일종목, task#149)

워크플로우(4-phase: 백엔드 구현 → 적대적 검토 → 수정 → 프론트) 실행. eco: sonnet 캡+ECO 주입. 배포·라이브 UAT 통과(verified: yes).

## Plan vs actual
- What went as planned:
  - 3슬라이스 전부: S1 `compute_exposure` 순수함수(통화 KR/US·섹터·단일종목 3축 + top-N 집중비율 + 임계 경고) + `GET /api/portfolio/exposure`(보유만·auth) + 9 단위테스트 + API_SPEC. S2 `ExposureTab`(RebalanceTab 자기완결 패턴) + Portfolio.jsx 분석 하위탭 '노출' 등록(모바일·데스크톱 2곳) + README + 경고배지 caution 전용색.
  - **인접 회고(리밸런싱 task#146·#147)의 "compute 조용한 엣지" 함정을 선반영** — full_total<=0·fx=0/None/<0·Decimal/float 혼산을 계획 단계에서 가드로 명시 → 적대적 검토 phase findings **0**(엣지가 이미 테스트·구현에 반영돼 리뷰가 잡을 게 없었음). 유닛테스트만 통과하고 리뷰서 터지던 2연속 패턴을 이번엔 사전 차단.
  - 라이브 UAT(테스트 계정, 보유 5종목 KR·US 혼합): 엔드포인트 200, 통화 KR/US·섹터(ETF→기타 버킷)·집중도(top3/5·최대단일)·경고(단일 000660 62.7%>25%·섹터 전기/전자>40%) 전부 정확 발화, 노출 탭 렌더·caution색(가격색 반전 없음)·종목명 해석 정상.
- Divergences (전부 저위험·정당):
  1. **CLAUDE_COWORK_API.md 미갱신** — 계획 DoD는 "API 문서 2종 동기"였으나 갱신 안 함. 근거: Cowork 문서는 enrich/backlog 전용 스코프이고 형제 `/rebalance`도 거기 없음(grep 검증: rebalance·exposure 0건). doc-sync 테스트는 Cowork 문서엔 *stale*만 검출하므로 green 유지. → 노출은 사용자 대면 read 엔드포인트라 Cowork 대상 아님.
  2. **rebalance.py 리팩터링 추가(계획 밖)** — 중복 방지 위해 `compute_rebalance`의 KRW 환산/no_fx/fx≤0/전체-포트 분모 블록을 `value_holdings_krw` 헬퍼로 추출, 두 계산 공통 소스화. 동작보존(rebalance 9테스트 무변경). 계획은 "재사용"만 명시.
  3. **차트 = CSS 바(recharts 미도입)** — SectorTab/MacroTab의 plain-CSS 비중바 관례 따름. 신규 의존성 0.

## Learnings
- Do differently next time:
  - **"API 문서 2종 동기" DoD는 Cowork 관련 엔드포인트에만 적용** — `CLAUDE_COWORK_API.md`는 외부 Cowork(enrich/backlog) 전용이라 사용자 대면 read 엔드포인트(`/portfolio/*` 등)는 `API_SPEC.md`에만 넣는다. CLAUDE.md의 "명세서 2개 모두 갱신" 규칙에 이 암묵적 예외가 있으니, 계획 그릴링에서 신규 엔드포인트가 Cowork 소비 대상인지 먼저 판별해 DoD를 좁힐 것(기계적 "둘 다"는 과함). → CLAUDE.md 해당 gotcha에 "Cowork 무관 엔드포인트는 API_SPEC만" 단서 추가를 고려.
  - **인접 회고의 함정을 계획 슬라이스에 선반영하면 적대적 리뷰가 비게 된다(좋은 신호)** — 이번은 리밸런싱 회고의 "compute 조용한 엣지(0-나누기·Decimal)"를 계획 완료기준·테스트 경계값에 미리 박아 findings 0. 회고→다음 계획으로의 함정 이월이 실제로 작동. compute/파생계산 슬라이스는 앞으로도 경계값(0·빈집합·Decimal)을 계획에 명시.
  - **라이브 UAT는 보유 데이터가 있는 테스트 계정으로** — test@portfolion.com이 KR·US 혼합 5종목을 가져 3축(통화·섹터·집중도)·기타 버킷(ETF)·경고 임계를 한 번에 자극. 빈 계정이면 렌더만 확인되고 로직은 안 걸린다.

## Doc updates
- CONTEXT.md promotion: none — 「노출·집중도」 용어는 fg-ask 그릴링 때 이미 등재. 실행 중 새 용어·의미 변화 없음.
- ADR added: none — `value_holdings_krw` 추출·엔드포인트 설계·임계값 하드코딩 모두 가역적(되돌리기 힘듦 미충족).
- 후속: 계획 비목표였던 **포트폴리오 베타(베타가중 노출)**는 스냅샷 beta 결측 심해 미착수 — 필요 시 별도 fg-ask 씨앗(결측 폴백/재생성 선행). CLAUDE.md doc-sync gotcha에 Cowork 예외 단서 추가는 별도 fg-quick 후보.
