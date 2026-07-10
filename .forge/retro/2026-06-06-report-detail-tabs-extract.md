# 2026-06-06 — 리포트 상세 탭 렌더 로직을 공통 `<ReportDetailTabs>`로 추출 (task 10)

## Plan vs actual
- What went as planned:
  - 신규 `frontend/src/components/reports/ReportDetailTabs.jsx`로 탭 바+4콘텐츠(요약/지표/심층분석/히스토리)+지표 서브탭+ETF 파생(`isEtf/analysisSub/detailTab`)을 단일화. Reports.jsx 상세 뷰·Ranking.jsx `ResearchDetail` 둘 다 전환. ✓
  - 추출 경계(탭+콘텐츠만, 헤더·스크롤·로딩은 부모) / 상태 모델(컴포넌트 내부 `useState` + `key={ticker}` 리셋) / 차이 흡수(9개 props) — 그릴링 합의대로. ✓
  - 빌드 통과(3회), 잔여 참조 0, 중복 ~270줄 제거. 라이브 4조합(상세·모달 × 일반·ETF) 사용자 UAT yes. **결과물=계획(동작 보존).**
- Divergences (모두 사소·의도적):
  - Ranking 모달 탭 바 마진이 Reports 스타일로 통일됨(+2~6px). 시각 무시 가능, 기능 무관.
  - Reports 같은 종목 재오픈 시 탭 리셋 미발생(`key={ticker}` 결과) — 다른 종목·드롭다운 날짜전환은 기존과 동일. 오히려 자연스러움.
  - 기존 dead import `ReportSectionText`(추출 이전부터 미사용) 정리(import 줄 재작성하며). 정의는 불변.
  - WHAT 무발산 → 재그릴링 불필요.

## Learnings
- Do differently next time:
  - **dedup 추출 전 "두 화면 차이점 표"를 먼저 만든 게 결정적이었다.** fg-ask에서 loading·null·스크롤·트래킹·refresh·history dates·헤더 차이를 표로 열거 → 추출 시 전부 props로 흡수해 **기능 회귀 0**. "겹쳐 보이는 중복"도 호출부별 미세 차이가 숨어 있으니, 합치기 전에 차이를 명시적으로 셈하는 절차가 효과적(다음 dedup에도 동일 적용).
  - **상태는 컴포넌트 내부 소유 + `key`로 리셋**이 부모의 수동 리셋 라인보다 깔끔. 단 `key` 선택이 리셋 타이밍을 결정하므로(여기선 `ticker` → 드롭다운 날짜전환은 탭 유지) 의도와 맞는 키를 골라야 함.
  - 이로써 etf-report-tabs retro의 "리포트 탭 로직 2곳 중복" 학습이 해소됨 — 이후 ETF류 조건 분기는 `ReportDetailTabs` 한 곳에서 관리.

## Doc updates
- CONTEXT.md promotion: none (`ReportDetailTabs`는 컴포넌트명, 도메인 용어 아님)
- ADR added: none (컴포넌트 추출은 되돌리기 쉽고 난해하지 않음 → ADR 3조건 미달)
