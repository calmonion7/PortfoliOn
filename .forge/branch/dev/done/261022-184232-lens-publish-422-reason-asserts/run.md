# RUN — 렌즈 발행 음성 테스트 422 사유 단언 보강 (task#401)

실행: 2026-10-22 · fg-loop 드라이브 · 워크플로 없이 메인 세션 직접 실행(테스트만 바뀌는 소규모라 단일 실행이 더 싸다)

## 슬라이스 결과
- S1 `tests/_reject.py::assert_rejected` 작성 — ✅ 계획대로. 목록 detail은 `loc`(완전 일치) + (`type` | `msg`)를 **강제**(loc만 주면 단언 자체가 실패)하고, 문자열 detail은 `msg`만 받는다. 실패 메시지에 실제 detail을 담음
- S2 422 단언 69곳 이전 — ✅ 계획대로. 63곳은 줄 단위 원문 대조 스크립트로, 3곳은 손으로 바꿈(아래). 사유는 캡처한 실제 detail에서 골랐다
- S3 AST 재발 가드 `tests/test_reject_reason_guard.py` — ✅ 계획대로(별도 파일, `test_no_print.py` 선례). 세 형태 심기 각각 빨강
- S4 `backend/tests/CLAUDE.md` 가토 정정 — ✅ 계획대로

## DoD baseline → after
1. 회귀 가드(두 파일 pytest): 174 passed → 174 passed (사전에도 통과하던 회귀 가드 — 그대로가 정상). 가드 파일을 포함하면 175 passed
2. 이빨(9렌즈 주입):
   - ⓐ 지목 6테스트: 6 green(엉뚱한 사유로 통과) → **6 red**
   - ⓑ 초록인데 422 사유가 `('body','lenses') too_short`뿐인 테스트: 사전 비교 대상 5+α → 주입 실행 전체 54 failed / 120 passed 중 다음 2개만 남음 — 둘 다 렌즈 수 겨냥 테스트다:
     - `test_lens10_required_nine_lens_publish_is_422`(422 전부 too_short)
     - `test_publish_validation_422`의 9렌즈 케이스(같은 테스트의 title 누락 케이스는 `missing` 사유)
     - `test_v2_lens_ids_must_be_1_to_10_exactly_once`·`test_lens10_id_set_rules_422`는 다른 케이스(id 중복·id 11)가 빨강이라 초록 목록에 없다
     - 응답 단위로 보면 렌즈 수 겨냥 4테스트 밖의 초록 테스트에서 too_short-only 응답은 0건이다(loop C2 판정기)
   - ⓒ 주입 플러그인을 빼고 다시 돌림 → 174 passed
3. 재발 가드: 해당 비교 69건 → 0건(독립 AST 계수기). 임시로 심은 3형태 `r.status_code == 422`·`422 == r.status_code`·`r.status_code == status` → 각각 **빨강**, 원복(cmp 일치) 뒤 초록
4. `grep -n "detail\[\]\.loc\`까지" backend/tests/CLAUDE.md`: 1히트 → **0히트**
- 전체 스위트: 2590 passed → 2591 passed(가드 +1)
- 앱 코드: `git diff --name-only ddd8fdc -- backend ':!backend/tests'` → 빈 출력

## 계획과 실제가 어긋난 점·현장 결정
- **손으로 바꾼 3곳**(줄 단위 치환이 맞지 않는 형태):
  - 876 매개변수형 `== status`: 422 케이스는 헬퍼를 타고, 201 케이스는 `assert resp.status_code == 201` 리터럴로 분기했다. `== status`를 남기면 가드의 비리터럴 규칙에 그대로 걸린다
  - 417 NaN/Infinity 반복문: 원소마다 기대 `loc`이 달라 `zip(raws, locs)`로 짝지었다(`finite_number`)
  - `test_analyst_reports.py` v1 반복문: 두 본문의 사유가 달라(`format` missing / literal_error) `(body, why)` 짝으로 바꿨다
- 729줄(경계 1개·두 색 게이지)은 오류가 2개(boundaries·zones too_short)다. 「세 색 모두」 규칙의 대상인 `zones too_short`를 골랐다
- 512줄 바로 아래의 기존 `format` loc 단언(513)은 헬퍼와 겹치지만, 수술적 변경 원칙에 따라 그대로 뒀다
- **루프 C1 판정 문구 정정**: 계획 DoD 1은 「가드를 넣으면 +1」이라고 했지만, 가드가 별도 파일이라 두 파일만 도는 명령으로는 +1이 잡히지 않는다. loop.md C1 명령에 가드 파일을 더했다. 하한은 175 그대로라 약화가 아니다
- 계측기(capture422·inject9·판정 스크립트)는 테스트 파일을 편집하지 않는 플러그인으로 만들었고, 스크래치패드에 둔다(커밋하지 않음). 모든 주입 실행은 `PYTHONDONTWRITEBYTECODE=1`로 돌렸다
- 조건부 코드 리뷰는 건너뛰었다(테스트만 바뀌는 저위험 변경)
