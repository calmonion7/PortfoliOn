# 2026-06-20 — 컴포넌트 프리미티브 일관성 (버튼·입력·탭·Guru 이중탭) (task#83)

> task#78 UI/UX 진단이 자동 분해한 fix 클러스터 6건(#79~84) 중 하나. 커밋 5440d239.

## Plan vs actual
- What went as planned:
  - S1~S4 완료. `components/ui/Input.jsx`+`Input.css` 신설. Digest/Calendar raw 버튼→ui/Button(secondary/ghost/iconOnly). GuruStats·GuruManagers·LoginPage 입력 통일. ReportDetailTabs 하위탭→공통 `.tab-btn sm`, Portfolio 새로고침을 icon-only ui/Button으로 탭바와 분리. Guru 이중탭(tab-in-tab)을 단일 탭행 [매니저목록|인기순|탑3|가중치]로 평탄화(GuruStats `view` prop 제어). 적대리뷰 통과(critical/major 0).
- Divergences:
  - **레거시 태그선택자가 프리미티브를 이김**: `.m-login input`/`.login-form input`(specificity 0,1,1)이 `.ui-input`(0,1,0)을 이겨 **컴포넌트 교체만으론 통일 안 됨** → 담당파일 내 인라인 inputStyle(클래스·태그선택자 모두 이김)로 우회. pc.css/mobile.css는 범위 밖이라 미수정 → dead 선언 잔존.
  - **S4 접근**: 데이터흐름 리프트(GuruStats를 view prop으로 제어, Guru가 단일 탭행 소유) 채택 — 위험했던 대안(내부탭→세그먼트 시각구분)은 불필요. GuruStats/GuruManagers 외부 소비처 0(grep) 확인 후 prop 변경 안전. 내부 TABS는 하위호환(view 없으면 기존 경로)으로 보존.

## Learnings
- Do differently next time:
  - **ui/ 프리미티브로 이관 시 기존 태그선택자/높은 specificity 규칙이 덮는지 먼저 확인** — 안 그러면 컴포넌트만 바뀌고 시각은 그대로다. 태그선택자(0,1,1) > 단일 클래스(0,1,0)이라 `.ui-input` 교체가 안 먹었다(CONCERNS #17로 승급). 근본 해결은 레거시 규칙 제거 후 프리미티브 단일화이나 이번엔 인라인 우회로 처리(범위).
  - **중첩 탭(tab-in-tab) 평탄화는 데이터흐름 리프트(자식이 `view` prop 받기)가 깔끔** — 외부 소비처 0을 grep 확인하면 prop 시그니처 변경이 안전하고, 하위호환 경로(prop 없으면 기존 동작)를 남기면 회귀 위험도 낮다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none
- 기타: `.forge/codebase/CONCERNS.md` #17 신규 "죽은/레거시 CSS가 수정을 오도"에 레거시 태그선택자 specificity 사례 포함(이 작업 #83 + #80의 교차 교훈). 후속: pc.css/mobile.css의 `.m-login input` dead 선언 제거 + `.ui-input` 단일소스화, GuruStats 내부 TABS(하위호환 경로) 제거.
