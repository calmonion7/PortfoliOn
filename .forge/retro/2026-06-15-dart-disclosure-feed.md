# 2026-06-15 — DART 공시 자동 피드 (task #51)

## Plan vs actual

- **계획대로**: S1~S7 done, 적대적 리뷰 PASS. `disclosures.py`(backlog corp_code 매핑 재사용, list.json 핵심유형 A·B·C·D)·`stock_disclosures`(rcept_no PK dedup·`_migrate` 런타임·app_schema 미러)·`disclosure_fetch` 일배치(국내 07:30, KR 보유+관심·US graceful)·`GET /api/report/{ticker}/disclosures`(catch-all보다 먼저 등록)·다이제스트/텔레그램 공시 섹션·프론트 "최신 공시(DART)" 섹션. **recent_disclosures(Cowork) 불변.** TDD 신규 24테스트 RED→GREEN, backend pytest 653, npm build OK, 라이브 DART 스모크(삼성 14건). 18배치(KR11/US4/공통3). Dynamic Workflow 4에이전트(백엔드 TDD 직렬→프론트∥문서→적대적 리뷰).
- **Divergences**:
  - **(중요·라이브 확인) DART list.json이 `pblntf_ty`를 응답에 echo하지 않음** → "단일 호출 후 응답필드 필터" 불가 → 핵심유형 A·B·C·D를 각각 개별 호출하고 질의 유형값을 stamp(종목당 4콜). 계획의 "핵심유형 필터"를 이 방식으로 충족.
  - 라우트 순서: `/disclosures`를 catch-all `/{ticker}/{date_str}`보다 먼저 등록 — 기존 함정(enrich/batch·backlog) 적용.
  - stock_disclosures PK=rcept_no 단독(DART 전역 유니크).
  - **(low) 다이제스트 헬퍼명 `_recent_disclosures`** — 로컬 함수(stock_disclosures 읽음, tickers.recent_disclosures 컬럼 write 0)지만 CONTEXT [[공시 피드]] 경계가 경고하는 그 이름과 충돌 → 명료성 follow-up.

## Learnings

- **Do differently next time**:
  - **(CLAUDE.md 승격) DART list.json은 `pblntf_ty`를 echo하지 않는다** — 응답필드 필터를 가정하면 안 되고 유형별 개별 호출·stamp가 필요. 라이브 확인이 또 안전망([[kis-backup-quote-source-2of2]]·[[kr-sector-precompute-fix]] "대표 1콜 ≠ 운영"의 외부 API판). "외부 API는 쿼리 파라미터와 응답 필드가 대칭일 거라 가정 말고 라이브로 응답 스키마 확인."
  - **catch-all 라우트 함정 3번째 재발(적용됨)**: report.py `/{ticker}/{date_str}` catch-all 앞에 구체 경로(`/disclosures`)를 먼저 등록. enrich/batch·backlog에 이어 CLAUDE.md gotcha가 실제로 작동(신규 외부데이터 엔드포인트는 catch-all 순서를 항상 점검). 신규 승격 불필요(이미 문서화).
  - **신규 store는 Cowork 소유 필드와 이름·개념 경계를 명확히**: fg-ask 때 [[공시 피드]] 용어로 recent_disclosures와 분리한 게 구현 내내 경계를 지켰다. 다만 다이제스트 헬퍼명이 그 경계를 흐릴 뻔(rename 후속).
- **검증 게이트**: 자동 게이트 pytest 653·TDD 24·적대적 리뷰 PASS·라이브 DART 스모크(삼성 14건)·메인 세션 재확인으로 `verified: yes`. 커밋 76893062 push. 배포 후 글랜스: 리포트상세 공시섹션·다이제스트 텔레그램.

## Doc updates

- CONTEXT.md promotion: none ([[공시 피드]]는 fg-ask 때 등록).
- ADR added: none (DART 패턴 + ADR-0006 범위 내).
- **CLAUDE.md: line 196 disclosures gotcha에 "list.json pblntf_ty echo 안 함→유형별 개별 호출·stamp" 한 줄 보강**(이 회고 학습 승격). disclosures 서비스 본문 gotcha는 실행 중 docs 에이전트가 작성.
- 코드: commit 76893062(기능, main push). 회고 CLAUDE.md 보강은 별도 커밋 예정.
- **follow-up 후보(low)**: 다이제스트 `_recent_disclosures` 헬퍼명 → `_recent_disclosure_feed` 등으로 rename(명료성).
