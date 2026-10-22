# RUN — 렌즈 10 「위험의 전례」 2부: 필수화 + 야간 루틴 프롬프트 전환 (task 392)

실행: 2026-10-21 · 워크플로 없이 메인 세션 직접 실행(직렬 슬라이스·파일 소수 — 1부 회고와 같은 판단), 적대 검토만 서브에이전트 1명(eco → sonnet).
착수 조건: task 393 봉인 STATUS에 「사람 화면 확인 OK 2026-10-21」 — 충족.

## 슬라이스별 결과
- S1 필수화(TDD) — ✅ 계획대로. red: 계약 테스트 정확히 2개 실패(`lens10_required_nine_lens_publish_is_422`·`test_publish_validation_422`) → `LensPublishBody` `min_length=10`·id 집합 `range(1, 11)` 단일 → green. ⚠ 계획에 없던 픽스처 이동: `crcl_body()`·`VALID_BODY`를 10렌즈 기본으로 올렸다(안 올리면 9렌즈 픽스처의 음성 테스트가 「렌즈 10 누락」이라는 엉뚱한 이유로 422가 돼 거짓 통과 — 예: `test_publish_lens_metrics_nan_change_pct_rejected_422`).
- S2 프롬프트 전환 — ✅. `1~9` 3줄 + 같은 집합의 다른 형태 3곳(「9렌즈」 형식명 · 판단 렌즈 나열 `1·2·6·7·9` 2곳)도 고침. 렌즈 10 지침 6항목 + 예시 JSON에 렌즈 10 객체(파싱·`LensIn` 통과 확인) + 사전검증 ⓐ 1~10·렌즈 10 항목 + ⓛ 서버 필드에 `base_rate`. 범위 테스트 1개 추가(red → green).
- S3 문서 — ⚠ DoD 4 패턴(`10 선택\|선택 렌즈 10`)이 COWORK에서 0히트였다(계획서가 예고한 경우) — 1부 실제 문구(「10은 선택」「…는 선택」「1~9 완전성」「렌즈 1~9 작성」「9 또는 10」)로 넓혀 감사. API_SPEC 7곳·COWORK 6곳·README 1·CONTEXT 1·ADR 보정 절 1줄. 옛 판 서술(「그 이전 판은 1~9」)은 의도적으로 남김. 계획 밖으로 프로브 2종·`lens10.test.jsx` 주석의 「렌즈 10은 선택」(거짓이 될 서술)도 고침 — 단언은 이미 9/10 공존이라 무변경.
- S4 배포·관측 — ⏸ dev 커밋 `49406f3` push · PR #27 생성까지. 머지(사람)·DoD 5 라이브 확인 대기.

## DoD baseline → after
1. `pytest -k lens10_required`: 선택 0개(exit 5) → 3 passed
2. 회귀: 백엔드 4파일 183 passed(전체 2589 → 2590) · vitest lens10 + AnalystReport 45 passed — 회귀 가드, baseline에서도 통과
3. `grep -c "1~9" scripts/cowork-routine-prompt.md`: 3 → 0 · `test_analyst_section_requires_lens10_with_precedents` red → green
4. `grep -c "10 선택\|선택 렌즈 10"`: API_SPEC 1·COWORK 0 → 0·0 (넓힌 패턴 기준 13곳 → 의도된 옛 판 서술만)
5. 라이브: ① ✅ PR #27 머지 `8afdb6e` → Deploy run 39578481479 `headSha=8afdb6e`·`success`, 세대 `261021-183814-8afdb6e` ② ✅ 운영 `scripts/cowork-routine-prompt.md` == `git show 8afdb6e:` (`cmp` 동일, `1~9` 0건) ③ ✅ 사용자 지시로 수동 fire 1회(18:48:01 KST, curl `POST /api/admin/cowork/fire` — 「LHX를 7일 게이트·회당 상한과 무관하게 지금 발행」, 직전 판 10-09) → `GET /api/analyst-reports/LHX/2026-10-21` 200(18:49:09, 데이터 대조로 판정) · 렌즈 id `[1..10]` · 렌즈 10 `precedents` 3건(현실화 2·비현실화 1) · 서버 `base_rate` `{total 3, realized 2, not_realized 1, partial 0}`. 배포 전 판 6건(10-21)은 000660(393 파일럿)만 1~10이고 나머지는 1~9 — 옛 판이라 정상
- 「통과하면서도 깨질 수 있는 방식」 관측: 새 판 2건(000660 파일럿·LHX)의 outcome이 둘 다 「전부 현실화」가 아님 — 반례를 빼는 습관 신호 없음. 야간 판 표본은 이후 누적

## 적대 검토
HIGH 0 · MED 0 · LOW 3. 고침 1: 라우터 `:41` 절 제목·`:306` POST docstring(OpenAPI에 노출)의 「9렌즈」. 남김 2: `.forge/CONTEXT.md` 「렌즈」 9개 질문(1부가 「브랜치 CONTEXT 오버레이 우선, fg-merge 때 통합」으로 남긴 항목) · ADR 본문의 역사 서술. 서비스·스키마·프론트 주석의 「구조 축·9렌즈」 형식명도 1부와 같이 남김(옛 판을 함께 다루는 계층).

## 그 밖
- 작업트리에 이전 세션(task 393 회고 스킬 승급)이 남긴 `.claude/skills/deploy-ops/SKILL.md`·`live-uat-probes/SKILL.md` 미커밋 변경이 있었다 — 내 변경이 아니라 커밋에서 뺐다.
- 「통과하면서도 깨질 수 있는 방식」(루틴이 반례를 습관적으로 뺌)은 머지 후 첫 야간 판 2~3건의 `outcome` 분포로 본다 — 393 파일럿은 현실화 3·부분 1·비현실화 1.
