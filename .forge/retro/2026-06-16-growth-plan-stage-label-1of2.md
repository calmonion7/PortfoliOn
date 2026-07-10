# 2026-06-16 — 장기 성장 계획 단계 라벨 (part 1/2): 작성자 기입 label 배선 + 레거시 임상 라벨 중립화

## Plan vs actual
- What went as planned:
  - S1 `Sections.jsx`: 칩 텍스트 `item.label || sc.label || item.status`, `STATUS_CFG` `임상3상/임상2상`→`3단계/2단계`(키·색상 유지), `npm run build` 통과, `frontend/src` "임상" 잔존 0.
  - S2 `CLAUDE_COWORK_API.md`: `initiatives[].label` 필드 행 신설, `status` 설명 임상 비종속화, 예시 페이로드 phase3에 `label:"임상3상"` 시연.
  - 두 슬라이스 모두 additive, 단일 커밋 `6be4c94f` main 배포.
- Divergences:
  - **렌더 가드 변경(슬라이스 문구 초과)**: 계획 S1은 "칩 텍스트"만 명시했으나 DoD(a)("label 있으면 그 문구를")를 status 없는 label-only 이니셔티브에서도 만족시키려면 가드 `item.status &&` → `(item.label || item.status) &&`까지 바꿔야 했다.
  - **UAT 방법 교체**: 계획은 "Playwright UAT(test 계정)로 리포트 상세 확인"이었으나 2of2 미실행이라 라이브 리포트엔 아직 label이 없어 새 분기를 볼 수 없었다 → Vite `ssrLoadModule`로 GrowthPlanSection을 5케이스 직접 SSR 렌더해 전 분기(label우선/phase3폴백/phase2폴백/label만/launched) 결정적 검증. `HAS_IMSANG:false`.
  - **API_SPEC.md 무변경 확인**: grep 결과 구조화 growth_plan/initiatives는 API_SPEC에 미문서(string 메모만) → Non-goal 확인, 변경 불필요.

## Learnings
- Do differently next time:
  - **라벨 배선의 part-1은 라이브 데이터로 UAT 불가** — 후속 part가 그 필드를 채우기 전엔 어떤 레코드에도 값이 없어 새 표시 분기를 라이브로 못 본다. 배선 검증은 **격리 렌더(컨트롤된 props)**로 하고, 실데이터 확인은 후속 part UAT로 넘긴다.
  - **이 프로젝트 dev 서버(5173)는 모든 경로를 SPA index.html로 폴백** — standalone HTML 엔트리(`/uat-foo.html`+`/uat-foo.jsx`)를 추가해도 dev 서버가 index.html을 돌려줘 빈 렌더가 된다. 격리 컴포넌트 검증은 **Vite `createServer({middlewareMode,appType:'custom'})` + `ssrLoadModule('/src/...')` + `renderToStaticMarkup`** 가 동작한다. (스크립트는 `frontend/` 안에 둬야 ESM이 frontend/node_modules의 vite/react를 해석함 — job tmp에 두면 `ERR_MODULE_NOT_FOUND`.) 인라인 스타일 칩 텍스트는 `border-radius:3px>([^<]+)<` 정규식으로 추출해 단언 가능.
  - **슬라이스 완료기준을 DoD 분기와 교차검증할 것** — 슬라이스 문구("칩 텍스트")가 DoD의 모든 분기(label-only도 칩 표시)를 담지 못해 렌더 가드까지 추가로 손봐야 했다. 슬라이스는 DoD의 부분집합이 아니라 전 분기를 커버해야 한다.

## Doc updates
- CONTEXT.md promotion: none (`[[단계 라벨]]`은 그릴링에서 이미 추가됨, 신규 용어 없음)
- ADR added: none (additive 필드 + 라벨 문구 변경 → hard-to-reverse 아님, 플랜도 ADR 게이트 미충족 명시)
- 프로젝트 메모리 `reference-frontend-uat` 갱신: dev 서버 SPA 폴백 → standalone HTML 하니스 불가, Vite SSR 렌더 우회법 추가
