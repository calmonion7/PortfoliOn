# run — 렌즈 원자료 원문 링크 (task#409)

- S1 (TDD) 테스트 `backend/tests/test_analyst_input_url.py` — ✅ 구현 전 수집 오류(빨강) 확인 후 작성
- S2 백엔드 — ✅ `services/link_check.py`(check_url·sanitize_input_urls), `RawInput.url`(https·≤500), 응답 `dropped_urls`. 전체 pytest 2658 통과
- S3 화면 「원문 ↗」 — ✅ vitest 64/64(링크 단언 포함). https 아닌 값은 그리지 않음
- S4 루틴 프롬프트 — ✅ 형식 줄·예시에 `"url"`
- S5 문서 — ✅ API_SPEC·COWORK(표 행·원자료 문장·예시·버림 표·응답 `dropped_urls`)·CONTEXT(dev) 갱신, doc_sync 초록
- S6 dev 실측 — ⚠ fd98634 Deploy run 40182593550 success. LHX 발행: 실재 URL(example.com) 유지, 404·DNS 실패·127.0.0.1은 `dropped_urls`에 담김. 360px 스크린샷(screenshots-task409/lens3.png)에 「원문 ↗」(href·_blank·noopener, 44px) 확인
- S7 운영 — ⚠ 기존 draft PR https://github.com/calmonion7/PortfoliOn/pull/41 에 누적(머지·main 세대 확인은 사람 몫)

DoD baseline → after: backend 181 → 210(대상 3파일), vitest 63 → 64.

⚠ 발견(결정 필요): **sec.gov는 이 User-Agent에 없는 경로도 403(·간헐 503)을 준다** — 설계상 403은 유지라서 SEC 링크는 지어낸 주소도 못 거른다(example.com은 정상 판별). SEC는 연락처가 든 UA를 요구한다. UA에 연락처를 넣을지는 사용자 결정 사항으로 남김. 소프트 404와 함께 알려진 한계.
dev LHX 2026-10-25 판은 테스트용 URL이 박힌 채 dev DB에 남아 있다(같은 날 재발행하면 덮임).
