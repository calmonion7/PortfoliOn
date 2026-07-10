# 2026-06-20 — UI/UX 전체 서비스 진단 + 발견사항 backlog 자동 분해 (task#78)

## Plan vs actual
- What went as planned:
  - 5개 슬라이스 전부 완료, DoD 충족. 라이브 캡처(prod+test, PC+모바일 34컷) → 13영역 병렬 8차원 비평(118 발견) → 시각 Artifact 발행 → High/Med 6 클러스터 backlog(task#79–84) 분해 + Low 37 리포트 체크리스트.
  - 캡처 인프라 실현가능성을 소규모 시험으로 선검증(Playwright/Chromium/prod도달/로그인)한 게 주효 — 본격 캡처 전 막힘 없음.
- Divergences:
  - **PC 리포트 상세 미캡처**: 홈 리포트 목록이 재내비게이션 시 로딩으로 재진입(장중 라이브 가격 폴링 + 마스터-디테일 레이아웃)하는 레이스로 PC 상세 4탭 진입 실패. 모바일 상세 4탭으로 대체, "느린 로드/스켈레톤 부재"를 finding으로 채택.
  - **'차단급 빈화면 2건' 적대적 재검증 → 재분류**: 비평이 대시보드·시장을 "데이터 있는데 빈화면(데이터 손실급)"으로 헤드라인했으나 라이브 재검증 결과 데이터 손실 아님 — 대시보드는 시딩발 캐시 staleness(버스트 후 5건 정상), 시장은 콜드캐시 "데이터 수집 중" 빈상태. synthesis 정정(verification_notes 2건 + 클러스터 #4 재구성 + 헤드라인 수정).
  - 시딩을 프론트 UI 대신 직접 API POST로 수행(비대화식). 라이트 테마만 감사(test 계정 설정). 기존 stale `screenshots.js` 대신 `capture-ux.js`/`capture-report-detail.js` 신규 작성.

## Learnings
- Do differently next time:
  1. **헤드리스 SPA 캡처는 "로딩 완료" 대기를 슬라이스1부터 내장**. `networkidle`/고정 timeout으로는 부족 — 라이브 폴링/마스터-디테일이 있는 화면은 재내비게이션 시 로딩으로 재진입한다. `waitForFunction(()=> !body.innerText.includes('불러오는 중') && 콘텐츠 셀렉터 존재)`로 "스피너 소멸 + 콘텐츠 안정"을 명시 대기할 것. (이번에 PC 상세 캡처 2회 실패 후에야 적용 — 비용 낭비.)
  2. **세션 중 직접 API 시딩은 프론트 캐시 무효화 경로를 우회 → 캐시 staleness가 리뷰를 오염**. 보유를 `POST /api/portfolio`로 시딩하면 `usePortfolioData`의 대시보드 캐시 무효화(`DELETE /api/stocks/dashboard/cache`)가 안 타, 헤더 KPI(라이브)=5건인데 그리드(300s 캐시)=빈 상태로 캡처돼 비평이 오판. → UI 플로우로 시딩하거나 **시딩 직후 대시보드 캐시 버스트 후 캡처**.
  3. **시각 단독 비평은 빈/empty 화면을 "데이터 손실 버그"로 과대주장한다 → 고심각도 빈화면 발견은 보고 전 라이브 재검증 필수**. 스크린샷만으로는 데이터손실 vs 캐시/로딩 아티팩트를 구분 못 한다. 적대적 자체검증(캐시 버스트 후 GET=정상, 시장=콜드캐시 빈상태)이 false-critical 2건을 잡았다. 향후 UI 감사 워크플로우는 비평 에이전트엔 "빈/empty 화면은 needs-verification으로 표기", 종합/메인엔 "High 빈화면 주장은 라이브 대조 후 분류"를 규약화할 것. (fg-run 조건부 리뷰/적대적 검증 규율의 유효성 입증 사례.)
  4. (부차) test 계정이 라이트 테마라 라이트만 감사. 다음 UI 감사 시 테마 토글 캡처로 다크 대비 문제까지 커버 검토.

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음 — 방법론/프로세스 학습)
- ADR added: none (하드투리버스 결정 아님 — 모두 되돌리기 쉬운 캡처/검증 방법론)
- 비고: 대시보드 라이브-vs-캐시 그리드 정합성 갭은 기존 `.forge/codebase/CONCERNS.md` #5/#7과 동류 — 신규 문서화 불필요. 후속 fix는 backlog task#82로 추적.
