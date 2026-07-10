# 2026-06-20 — Reports.jsx 종목관리 핸들러 → useStockManagement 훅 추출 (R4 part 2/2)

## Plan vs actual
- What went as planned:
  - `useStockManagement.js`(105줄)로 종목관리 핸들러·모달 state verbatim 추출(소유 state modalOpen·editing·addMode·promoteTarget·mutError, args=map·fetcher·toast·activeTab·setActiveTab). Reports.jsx는 훅 소비 → **391→312줄**. 모달/FAB/카드 소비처 배선 무변경.
  - characterization 14개(renderHook+api/toast/window.confirm 모킹): handleSave 추가/수정×관심/보유 4조합·report_queued poll 트리거·실패, handleDelete confirm 분기·watch/holding 메시지, handlePromote 성공, openEdit/openAdd. Vitest 31 green·build green·신규 lint 0.
- Divergences:
  - **라이브 Playwright UAT 미실행** — part 1과 동일, renderHook 테스트(14)+build로 대체. ⚠️ plan이 미리 지적한 "테스트계정 보유=0" 한계를 단위테스트로 보강(아래 학습).

## Learnings
- Do differently next time:
  - **데이터 변이(CRUD) 핸들러는 verbatim 추출 + 모킹 테스트로 계약을 정밀 고정하면 정식 코드리뷰를 안전히 생략할 수 있다.** api 경로·페이로드·토스트 문자열·confirm 메시지를 토씨까지 단언(`api.post('/api/portfolio', payload)`, `'TSLA를 완전히 삭제하시겠습니까?'` 등)하면 "옮기다 한 글자 틀림"을 잡는다. §3 리뷰 생략은 "신규 로직 아닌 재배치 + 분기 전수 단언 + 모달 배선 잔존 확인"이 받쳐줄 때만.
  - **source-of-truth(plan) 충돌 시 plan을 따르라 — 미사용 반환은 무해.** `pollReportGeneration`/`refreshAfterMutation`은 Reports.jsx가 직접 안 쓰지만 plan 결정이 반환 핸들러로 명시 → 반환에 포함하고 소비처는 쓰는 subset만 destructure(미사용 반환 prop은 lint 무영향). "최소 surface" 본능과 plan 계약이 부딪치면 plan 우선.
  - **report_queued→setInterval 트리거 검증은 `vi.spyOn(globalThis,'setInterval').mockReturnValue(1)` 후 즉시 `mockRestore`** — 실제 스케줄 없이 호출 인자(`expect.any(Function)`, 15000)만 단언하고 곧장 복원해 React 스케줄러 간섭·인터벌 누수 회피.
  - **라이브 UAT 공백은 "데이터가 없는 경로"를 단위테스트로 메운다.** 테스트계정 보유=0이라 보유 전용 라이브 플로(편집·삭제 보유분기·승격 결과)를 화면에서 못 밟으므로, handleDelete 보유분기·openEdit holdings맵·handleSave 수정×보유를 모킹으로 전수 커버. 라이브로 못 닿는 분기일수록 단위테스트 가치가 크다.

## Doc updates
- CONTEXT.md promotion: none (`useStockManagement`는 구현 디테일 — plan도 "Glossary terms: none" 명시)
- ADR added: none (핸들러 재배치는 가역적, ADR-0018/0019 기존 결정 내)

## R4 종합(part 1·2)
- `Reports.jsx` **447→312줄**(135 감소). 필터/정렬=`useReportFilters`, 종목관리=`useStockManagement`로 분리, Reports.jsx는 오케스트레이션(상세 state·데이터 훅 3종·effect·pnlOf·openDetail)만 잔류. Vitest 하니스(ADR-0019) 신설·단위테스트 30 + 스모크. main 6793157d 커밋·푸시.
