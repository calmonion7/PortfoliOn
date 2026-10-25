<!-- forge-slug: lens-inputs-tidy-link-2of2 -->
<!-- task: 409 -->
<!-- part: 2/2 -->
<!-- tdd: on -->
# 렌즈 원자료에 원문 링크를 붙인다 — 루틴이 URL을 적고, 서버가 발행 때 열어 확인한다

## 목표 / 비목표
- 목표: 원자료 한 건의 출처 글 아래에 「원문 ↗」을 보이고, 누르면 그 값을 옮겨 온 원문 문서가 열리게 한다.
- 현황(조사 확정):
  - 원자료 형식 `RawInput`(`backend/routers/analyst_reports.py`)에는 `ref`(글)만 있고 URL 칸이 없다.
  - 모델이 `_FORBID`(extra=forbid)라서, 루틴이 지금 `url`을 보내면 422로 거부된다.
  - 저장은 `analyst_lenses.py:604`가 inputs를 그대로 박제하므로, 칸만 추가하면 저장·조회에 실린다.
- 결정(fg-ask 2026-10-25):
  - 링크 출처: 원자료 형식에 **선택 칸 `url`**을 추가하고 루틴이 적는다. 앞으로 발행하는 판부터 링크가 붙는다. 기존 판은 링크 없이 그대로 둔다(발행물은 불변이고, 지어 붙이지 않는다).
  - 범위: **원자료(`inputs`)만**이다. 민감도 축·게이지 `current_ref`·렌즈 10 사례 `ref`에는 넣지 않는다.
  - 모양: 출처 글은 그대로 두고 그 끝에 **따로 「원문 ↗」**을 둔다. 누르는 영역은 44px이고 새 탭으로 연다.
  - 지어낸 URL 대응: **발행 때 서버가 URL을 열어 확인**한다. 루틴 프롬프트에도 「실제로 연 문서의 주소만, 모르면 생략」 규칙을 넣는다.
  - 버림 기준: **확실히 없을 때만** 버린다.
    - 버림: 404·410, 도메인 조회 실패, 연결 거부.
    - 유지: 403·429·5xx·타임아웃·3xx.
- 구현 방침(질문하지 않고 정함):
  - URL 확인에 실패해도 **발행은 실패시키지 않는다**. 해당 원자료의 `url`만 `null`로 비운다. 발행 응답에 `dropped_urls: [{lens, key, url, reason}]`를 실어 루틴 로그에서 보이게 한다.
  - 스키마 단계(422): `https://`로 시작하지 않으면 거부한다(`javascript:`·`http:`·사내 주소 차단). 길이는 ≤500자다.
  - 서버 요청(SSRF 방지):
    - 호스트를 `getaddrinfo`로 풀어서, 사설·루프백·링크로컬·예약 IP가 하나라도 나오면 `reason: private`로 버린다.
    - **리다이렉트는 따라가지 않는다**(3xx는 「있음」으로 보고 유지한다). 리다이렉트 대상이 사내 주소일 위험을 아예 없앤다.
    - 발행 주체가 admin·API 키라 DNS 리바인딩 TOCTOU는 받아들인다.
  - 요청 방식: `GET`, `stream=True`(본문은 읽지 않는다), 타임아웃 5초, 식별 가능한 User-Agent(`PortfoliOn link-check (+https://portfolion.taebro.com)`)를 쓴다. 판 하나의 URL을 스레드풀(≤8)로 병렬 확인하고, 같은 URL은 한 번만 확인한다.
    - `publish_report`는 sync `def`라 스레드풀 안에서 돈다. 공유 가변 상태는 두지 않는다(루트 가토 「동시성」).
  - 화면: `url`이 있을 때만 「원문 ↗」을 그린다. `<a href target="_blank" rel="noopener noreferrer">`로 만들고, `https://`가 아니면 그리지 않는다(이중 방어).
- 비목표:
  - 기존 판 소급 링크.
  - 사례·게이지·민감도 링크.
  - 링크 생존의 주기적 재확인.
  - 도메인 허용목록.
  - 리다이렉트 추적.

## 기준
- 용어: CONTEXT.md(dev 오버레이)의 「렌즈」 항목 중 원자료 출처 문장에 「원자료에는 원문 링크가 붙을 수 있고, 서버가 발행 때 열어 보아 확실히 없는 주소는 버린다」를 S5에서 추가한다(구현 뒤에 쓴다 — 미구현 동작을 글로서리에 먼저 박제하지 않는다).
- 관련 ADR: 없음. 되돌리기 쉽다(선택 칸이고, 확인 로직은 발행 경로 안에 국소적이다).
- 선행: 1/2(`lens-inputs-tidy-link-1of2`)의 묶음 렌더 위에 「원문 ↗」을 얹는다. 소프트 순서다.

## 작업 슬라이스
- [ ] S1. (TDD) 테스트를 먼저 쓴다 — `backend/tests/test_analyst_reports.py`(또는 새 `test_analyst_input_url.py`).
  - ⓐ 스키마: `url` 생략 → 통과. `https://…` → 통과. `http://`·`javascript:`·`ftp:`·501자 → 422.
  - ⓑ 확인 함수(네트워크는 mock — `requests.get`·`socket.getaddrinfo`를 패치한다):
    - 버림: 404·410 / DNS 실패(`gaierror`) / 연결 거부(`ConnectionError`) / 사설 IP(`10.x`·`127.0.0.1`·`169.254.x`·`::1`).
    - 유지: 200·301·403·429·503·타임아웃.
    - 모두 `allow_redirects=False`로 호출됐는지도 단언한다.
  - ⓒ 발행: 원자료 2건(살아 있는 URL·404 URL)으로 발행한다. 응답 `dropped_urls`에 404 건 1개(lens·key·url·reason)가 담기는지, 박제된 lens_report에서 그 원자료의 `url`이 `null`이고 다른 건은 유지되는지 단언한다. `services.db`는 mock한다(conftest `_block_real_db`).
  - 완료기준: 새 테스트가 **빨강**이다(구현 전). 기존 analyst 스위트는 초록이다.
- [ ] S2. 백엔드를 구현한다.
  - `RawInput.url: Optional[str]`와 https 검증을 추가한다.
  - 확인 함수는 `backend/services/`에 둔다. `publish_report`에서 `build_lens_report` 전에 inputs의 url을 확인·정리한다.
  - 응답에 `dropped_urls`를 싣는다(빈 배열 포함 — 키는 항상 있다).
  - 완료기준: S1이 초록이 되고, `cd backend && .venv/bin/python -m pytest`가 전체 무회귀다. (의존: S1)
- [ ] S3. 화면에 「원문 ↗」을 넣는다(1/2의 하위 행 안, 출처 글 아래).
  - vitest 단언: `url` 있는 원자료는 `a[href=url][target=_blank][rel~=noopener]` 「원문 ↗」이 있다. `url` 없음·`http://`면 링크가 없다.
  - 완료기준: 단언이 통과하고, `AnalystReport.test.jsx`·`lens10.test.jsx`가 무회귀다. (의존: S2)
- [ ] S4. 루틴 프롬프트를 갱신한다(`scripts/cowork-routine-prompt.md` ③ 원자료 형식).
  - `"url": "<https 원문 주소 — 선택>"`을 추가한다.
  - 규칙: 「이번 실행에서 **실제로 열어 본** 그 문서(공시 원문·실적 발표·IR 자료)의 주소만 적어라. 검색 결과·목록 페이지 말고 그 문서. 모르면 키를 빼라 — 지어낸 주소는 서버가 버리고 로그에 남는다.」
  - 예시 JSON 블록의 원자료 한 건에 `url` 예를 넣는다.
  - 완료기준: `grep -n '"url"' scripts/cowork-routine-prompt.md`에서 형식 줄과 예시가 모두 걸린다. (의존: S2)
- [ ] S5. 문서를 동기화한다(Cowork 소비 엔드포인트 → 2문서 모두).
  - `API_SPEC.md`와 `CLAUDE_COWORK_API.md`의 `POST /api/analyst-reports/{ticker}` 절을 고친다.
    - 원자료 형식에 `url`을 추가한다(COWORK `:718` 표 행, `:726` 「원자료 하나」 문장, `:690~696` 예시).
    - 응답 예시에 `dropped_urls`를 추가한다.
    - 버림 기준 표를 넣는다.
  - 착수 시 두 파일 전체에서 `'"ref"'`·`ref(출처`·`{value, unit, source, ref` 히트를 세어 **전부** 갱신한다(루트 가토 — Cowork 문서는 한 엔드포인트를 워크플로·절 두 곳에 적는다).
  - 조회 응답 절(`GET /api/analyst-reports/{ticker}`)에 원자료 필드 서술이 있으면 그곳도 고친다.
  - CONTEXT.md(dev) 문장을 추가한다(위 「기준」).
  - 완료기준: `grep -c 'url' API_SPEC.md CLAUDE_COWORK_API.md` 증가분이 각 절에서 확인되고, `test_api_doc_sync.py`가 초록이다. (의존: S2)
- [ ] S6. dev에서 실측한다.
  - dev push 후 Deploy run의 `headSha`와 `conclusion=success`를 확인한다.
  - dev 백엔드 컨테이너 안에서(시딩 스크립트와 같은 admin JWT 방식으로) 판 하나를 발행한다. 원자료에 **실재 URL 1건**(예: SEC EDGAR 10-K 원문)과 **지어낸 URL 1건**(같은 도메인의 없는 경로)을 넣는다.
  - 응답 `dropped_urls`에 지어낸 1건만 있어야 한다. dev 컨테이너가 외부 HTTPS에 나갈 수 있는지는 이 단계에서 확정한다 — 안 되면 멈추고 보고한다.
  - 360px 스크린샷: 「원문 ↗」이 출처 글 아래에 보이고, 눌러서 새 탭으로 원문이 열린다(href 확인).
  - (의존: S3·S5)
- [ ] S7. 운영에 반영한다.
  - dev→main PR을 만들고 **PR URL**을 넘긴다. 머지는 사람이 한다.
  - 머지 뒤 main Deploy run의 `headSha`·세대를 확인한다.
  - 다음 루틴 발행 판에서 `url`이 실렸는지와 `dropped_urls` 로그는 관찰 항목이다(이 작업의 완료 조건은 아니다 — 루틴 주기에 종속된다).
  - (의존: S6)

## 완료 정의 (DoD)
1. `cd backend && .venv/bin/python -m pytest tests/test_analyst_reports.py tests/test_analyst_report_lenses.py` (+ 새 테스트 파일) → 전부 통과한다.
   - 작성 시 사전 상태(2026-10-25): 기존 2파일 **181 passed**. 회귀 가드라 미리 통과하는 것이 맞다.
   - S1의 새 테스트는 아직 없다. 지금 `url`을 보내면 422이므로, 쓰면 빨강이 정상이다(forward check).
2. `cd frontend && npx vitest run src/pages/AnalystReport.test.jsx src/test/lens10.test.jsx` → 「원문 ↗」 단언을 포함해 통과한다.
   - 사전 상태: 62/62(1/2의 단언이 더해진 뒤 수치가 바뀐다). 링크 단언은 forward check다.
3. `cd backend && .venv/bin/python -m pytest tests/test_api_doc_sync.py` 초록 + 두 문서의 원자료 형식·응답 예시에 `url`·`dropped_urls`가 들어갔다.
4. dev 실측: 실재 URL은 유지되고 지어낸 URL만 `dropped_urls`에 담긴다. 360px 스크린샷에 「원문 ↗」이 보인다.
5. dev→main PR URL을 전달한다.
- 「이 단언이 통과하면서도 깨질 수 있는 방식」:
  - 단위 테스트는 `requests`를 mock하므로, **실서버가 실제로 어떻게 응답하는지**(SEC가 이 UA에 403을 주는지, 없는 경로에 404 대신 200 소프트 404 페이지를 주는지)는 보지 못한다. 이것은 DoD 4의 dev 실측이 맡는다. 소프트 404(200 + 「찾을 수 없음」 페이지)는 이 설계로는 잡지 못하는 알려진 한계다.
  - 사설 IP 차단 테스트는 `getaddrinfo` mock 값만 본다. IPv6 매핑 주소(`::ffff:127.0.0.1`)도 표본에 넣는다.
