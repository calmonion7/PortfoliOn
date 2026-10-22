<!-- forge-slug: lens-publish-422-reason-asserts -->
<!-- task: 401 -->
<!-- tdd: off -->
# 렌즈 발행 음성 테스트 422 사유 단언 보강

## 목표 / 비목표
- 목표: `POST /api/analyst-reports/{ticker}` 음성 테스트가 「422가 났다」가 아니라 **「*그* 이유로 422가 났다」**를 증언하게 한다. 그래서 다음에 검증을 조일 때(선택 → 필수, 범위 축소) 옛 모양 픽스처가 엉뚱한 사유로 422를 받아 거짓으로 통과하는 일(task#392 회고)이 조용히 반복되지 않게 막는다.
  - 공유 헬퍼 `backend/tests/_reject.py`를 만든다. `tests/_routes.py`와 같은 비테스트 공유 모듈이다.
  - 두 파일의 422 단언을 모두 헬퍼로 옮긴다. 대상은 `test_analyst_report_lenses.py` 64줄 + 매개변수형 1줄(876 `status_code == status`), `test_analyst_reports.py` 4줄이다.
  - AST 소스 스캔 가드로 「상태코드만」 단언이 재발하지 않게 막는다.
  - `backend/tests/CLAUDE.md` 가토를 실측에 맞게 바로잡는다.
- 비목표:
  - 앱 코드(`routers/analyst_reports.py`의 검증·오류 문구)는 바꾸지 않는다. 테스트만 바꾼다.
  - 다른 엔드포인트의 422 테스트(`test_tech_reports_router.py` 등)는 바꾸지 않는다. 발행 엔드포인트가 다르다.
  - 「사유가 정확히 하나뿐인가」는 단언하지 않는다. v1 본문 거부는 오류가 9개, 게이지 경계·조건 누락은 2개라서 맞지 않는다.
  - 201·404·409 등 다른 상태코드 단언은 건드리지 않는다.

## 정본
- 용어: `.forge/CONTEXT.md` 브랜치 오버레이의 「렌즈」. 새 용어는 없다.
- 관련 ADR: 없음
- **결정 사항(그릴링)**
  - **헬퍼 의미**: `detail` 안에 「지정한 사유」와 맞는 항목이 **하나 이상 있다**.
    - `loc`는 **완전 일치**(`('body','lenses',2)` 형태)로 본다. 접두 일치는 쓰지 않는다. `('body',)`가 모든 오류에 맞아 버리기 때문이다.
    - 필드 오류(pydantic `type`이 `too_short`·`extra_forbidden`·`finite_number`·`literal_error`·`missing`…)는 `loc` + `type`으로 맞춘다. pydantic 영어 `msg`에는 묶지 않는다.
    - 모델 검증 오류(`type=value_error`)는 `loc` + `msg`의 안정적인 한국어 조각으로 맞춘다. **이 중 8건은 `loc=['body']`뿐이라 `msg`가 유일한 판별자다**(원자료 누락·알 수 없는 원자료·단위 섞임·id 집합·렌즈 8 축 단위 2·민감도 정중앙 2).
    - 라우터 `HTTPException` 2건은 `detail`이 문자열이므로 부분 문자열로 맞춘다(통화 불일치, KR 국고채 필수).
  - **실측한 사유 지도**(작성 시점, 캡처 플러그인으로 73건 전수): 지금은 73건 **모두 의도한 사유로** 422가 난다. 형태별로 모델 검증 오류 36건, 필드 오류 35건(그중 오류 2개 2건, 9개 2건), 문자열 2건이다. 테스트별 실제 `loc`/`msg`는 아래 「재현」 명령으로 다시 뽑을 수 있다.
  - **노출 표면**(9렌즈 주입 실측): 주입 뒤 사유가 `lenses too_short`로 **바뀌는** 것은 본문 단위 검증기(`LensPublishBody` `model_validator`)와 라우터 `HTTPException`뿐이다.
    - 필드 오류와 렌즈 단위 검증기(`LensIn`)는 주입 뒤에도 목표 사유가 그대로 나온다. pydantic은 항목 검증에 실패하면 리스트 길이 검사를 생략하기 때문이다.
    - 따라서 「주입 시 음성 테스트 전부 빨강」은 **잘못된 기대**다. 아래 DoD 2를 판정 기준으로 쓴다.
- **재현(작성 시점에 만든 계측기 — 실행자가 다시 만들 것)**
  - 캡처 플러그인: `TestClient.post`를 감싸서 422 응답의 `detail`을 `{t: 테스트명, detail}` JSONL로 덧붙여 기록한다. 테스트명은 `pytest_runtest_call` hookwrapper로 잡는다.
  - 9렌즈 주입 플러그인: `pytest_collection_modifyitems(trylast)`에서 `tests.test_analyst_report_lenses.crcl_body`를 「렌즈 10을 뺀 판」을 돌려주는 래퍼로 바꾸고, `tests.test_analyst_reports.VALID_BODY["lenses"]`에서 id 10을 뺀다. **테스트 파일 자체는 편집하지 않는다.**
  - 실행: `cd backend && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=<scratchpad> .venv/bin/python -m pytest -q -p capture422 -p inject9 -p no:cacheprovider tests/test_analyst_report_lenses.py tests/test_analyst_reports.py`
    - `PYTHONDONTWRITEBYTECODE=1`은 필수다. 이 맥은 `.pyc`를 `sys.pycache_prefix`에 쓰므로, 끄지 않으면 원복한 뒤에도 옛 코드가 실행될 수 있다(tests 가토 task#369).
- 완료 정의(DoD):
  1. **회귀 가드**: `cd backend && .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_analyst_report_lenses.py tests/test_analyst_reports.py` → 전부 통과.
     - 작성 시점 사전 상태: **174 passed**. 회귀 가드라서 미리 통과하는 것이 정상이다. 헬퍼 이전 뒤에도 같은 수여야 하고, 가드 테스트를 넣으면 +1이다.
  2. **이빨(전진 검사)** — 9렌즈 주입 플러그인을 켜고 돌린다.
     - ⓐ 다음 6개 테스트가 **빨강**이어야 한다.
       - `test_v2_lens_ids_must_be_1_to_10_exactly_once` (id 중복 케이스)
       - `test_v2_unknown_input_key_and_bad_enum_422` (typo_key 케이스)
       - `test_v2_mixed_money_units_422`
       - `test_v2_lens8_currency_mismatch_422`
       - `test_sensitivity_center_must_match_forward_earnings[1.11-422]`
       - `test_sensitivity_center_must_match_forward_earnings[0.89-422]`
       - 작성 시점 사전 상태: 주입 상태에서 **6개 모두 초록**이다(엉뚱한 사유 `lenses too_short`로 통과). 전진 검사이므로 지금은 실패해야 정상이고, 실제로 실패한다.
     - ⓑ 같은 주입 실행에서 캡처 플러그인으로 「**초록인데** 그 테스트의 422 사유가 `('body','lenses') too_short`뿐」인 테스트를 센다. 남는 것은 **렌즈 수를 겨냥한 테스트뿐**이어야 한다.
       - 렌즈 수 겨냥 테스트: `test_lens10_required_nine_lens_publish_is_422`, `test_publish_validation_422`의 9렌즈 케이스, `test_v2_lens_ids_must_be_1_to_10_exactly_once`의 렌즈 9 누락 케이스, `test_lens10_id_set_rules_422`의 해당 케이스.
       - 판정 결과는 run.md에 테스트 목록으로 적는다.
     - ⓒ 주입 플러그인을 빼고 DoD 1을 다시 돌려 전부 통과해야 한다.
  3. **재발 가드**: 새 AST 가드 테스트를 추가한다. 선례는 `tests/test_no_print.py`.
     - 판정: 두 파일에서 `.status_code`를 422 리터럴 **또는 비리터럴(변수)**과 비교하는 `Compare` 노드가 0건이어야 한다. 비리터럴 비교는 876줄 `== status` 같은 매개변수형을 잡기 위한 것이다. 피연산자 순서가 `422 == r.status_code`로 뒤집혀도 잡아야 한다.
     - 「통과하면서도 깨질 수 있는 방식」 대응: 감사 패턴이 좁으면 가드는 통과해도 무의미하다. 그래서 작성 직후 다음 **세 형태를 임시로 심어 각각 빨강이 되는지** 확인하고 run.md에 적는다.
       - `assert r.status_code == 422`
       - `assert 422 == r.status_code`
       - `assert r.status_code == status`
     - 작성 시점 사전 상태: 가드 테스트는 아직 없다. 위 정의로 세면 **69건**이다(`status_code == 422` 64+4, `== status` 1).
  4. `backend/tests/CLAUDE.md`의 task#392 가토를 실측에 맞게 고친다.
     - ⓐ 「`detail[].loc`까지」를 다음으로 바꾼다: **필드 오류는 `loc`+`type`, 모델 검증 오류는 `loc`+`msg` 조각, 문자열 detail은 부분 문자열**. 근거는 본문 단위 검증기의 `loc=['body']` 8건이다.
     - ⓑ 헬퍼(`tests/_reject.py`)와 AST 가드의 존재를 적는다.
     - ⓒ 「노출 규모 33개 중 32개」 문장을 해소된 상태로 고친다. 실제 노출은 「본문 단위 검증기·HTTPException 6테스트」였다는 실측도 함께 적는다.
     - 판정: `grep -n "detail\[\]\.loc\`까지" backend/tests/CLAUDE.md` → 0히트.
     - 작성 시점 사전 상태: **1히트**. 전진 검사이므로 지금은 실패해야 정상이다.

## 작업 슬라이스
- [ ] S1. `tests/_reject.py` 헬퍼 작성. 위 「헬퍼 의미」를 따른다. 실패 메시지에는 실제 `detail`을 담는다(어긋났을 때 원인을 바로 보이게). — 완료기준: 헬퍼를 import하는 것만으로 두 파일이 DoD 1에서 174 통과.
- [ ] S2. 두 파일의 422 단언 69곳을 헬퍼로 이전한다. 각 사유는 캡처한 실제 `loc`/`type`/`msg`를 보고 고른다. 매개변수형(`ratio,status`)은 422 케이스에서 헬퍼를, 201 케이스에서 기존 단언을 타도록 분기한다. — 완료기준: DoD 1·2 통과, run.md에 2ⓑ 목록. (depends: S1)
- [ ] S3. AST 재발 가드 테스트 추가와 세 형태 심기 확인. — 완료기준: DoD 3. (depends: S2)
- [ ] S4. `backend/tests/CLAUDE.md` 가토 정정. — 완료기준: DoD 4. (depends: S2)
- 커밋: `dev` 브랜치에 커밋·push한다(dev push는 dev 스택만 재배포하며, 테스트만 바뀌므로 무해). 테스트 파일은 `paths-ignore` 대상이 아니라 dev 배포가 한 번 돈다. main 머지는 사람 몫이다.
