<!-- forge-slug: analyst-lens10-precedent-row-tidy -->
<!-- task: 395 -->
<!-- tdd: off -->
<!-- priority: medium -->

# 렌즈 10 「위험의 전례」 사례 행 정리

## 목표
심층 리포트 렌즈 10 카드의 사례 목록이 **모든 행에서 같은 모양**으로 읽히게 한다. 사용자 제보(모바일 스크린샷, 2026-10-21): 「정리가 안 된 느낌」.

진단(코드 `frontend/src/components/reports/LensReport.jsx` `PrecedentRow` 대조):
1. 머리가 `flexWrap` 한 줄(제목·기간·배지·`−`)이라 **제목 길이에 따라 배지가 아래로 떨어지는 행과 같은 줄에 남는 행이 섞인다**(task#394 증권사 행과 같은 결함 — `frontend/CLAUDE.md` flexWrap 가토).
2. 바깥 라벨 「같은 점·다른 점」 + `note` 본문의 「같은 점: … 다른 점: …」 → **라벨이 두 번 나온다**.
3. `+`/`−` 펼침 표시가 배지 옆에 떠 있어 의미 없는 대시처럼 보인다.
4. 기간이 `mono`라 「2018  하반기~2019」처럼 자간이 벌어진다.

## 정본·결정
- 용어: `.forge/branch/dev/CONTEXT.md`의 「전례」·「위험 기저율」(변경 없음).
- 결정 1(목업 확정): 행 머리 = **1줄 사례 제목 + 오른쪽 끝 펼침 화살표(⌄/⌃) / 2줄 결과 배지 + 기간**. 폭과 무관하게 모든 행이 이 2줄 구조다(줄바꿈 위치를 flex-wrap에 맡기지 않는다).
- 결정 2: 펼친 내용 = 「같은 점」「다른 점」「출처」를 **라벨 열 + 본문** 3줄로. `note`에서 「같은 점:」「다른 점:」 표지를 찾아 나눈다. **표지가 없으면 바깥 라벨 없이 원문 그대로**(중복 라벨 제거, 오분해 금지). 계약(Pydantic `Precedent`)·DB·응답 스키마는 **무변경**.
- 결정 3: 앞으로의 발행물이 항상 나뉘도록 루틴 프롬프트에 `note` 형식 「같은 점: …. 다른 점: ….」을 명시하고, 같은 서술을 두 API 문서의 `precedents` 행에도 반영한다(Cowork가 발행 주체라 `CLAUDE_COWORK_API.md` 포함).
- 기간은 `mono` 제거, `tnum`만 유지.

## 슬라이스
- [ ] **S1. 행 머리 2줄 고정** — `PrecedentRow` 버튼 안을 `[제목 + ⌄]` 행과 `[배지 + 기간]` 행 두 블록으로. `data-precedent-head`(1줄)·`data-precedent-meta`(2줄) 표지를 단다. `aria-expanded`·`minHeight 44`·키보드 동작 유지. 화살표는 `aria-hidden`.
  - 완료: vitest — 모든 사례 행에 head·meta가 각각 1개, meta 안에 배지와 기간이 있고 head 안에는 없다.
- [ ] **S2. 같은 점·다른 점 분리** — `note` 파서(표지 「같은 점:」/「다른 점:」, 앞뒤 공백·마침표 정리). 펼침 영역 = 라벨 열(같은 점·다른 점·출처) 정렬 3줄. 표지가 하나도 없으면 원문 한 문단(라벨 없음). 한쪽 표지만 있으면 그쪽만 라벨.
  - 완료: vitest — ⓐ 「같은 점: A. 다른 점: B.」 → `[data-precedent-same]`=A, `[data-precedent-diff]`=B ⓑ 표지 없는 note → 원문 그대로 + 「같은 점」 문자열 0회 ⓒ 어떤 경우에도 「같은 점·다른 점」 바깥 라벨 0회.
- [ ] **S3. 프롬프트·문서 형식 고정** — `scripts/cowork-routine-prompt.md:46`의 `note` 설명에 형식 「같은 점: …. 다른 점: ….」 명시. `API_SPEC.md`·`CLAUDE_COWORK_API.md`의 `lenses[].precedents` 행 같은 서술(파일 전역 `grep -n "precedents"`로 히트를 세 전부 반영 — task#318 가토). `backend/routers/analyst_reports.py:160` 주석도 같은 형식으로.
  - 완료: 세 파일 각각 `grep -c "같은 점: "` ≥ 1.
- [ ] **S4. 라이브 프로브 축 + 육안** — `scripts/uat369-lens-report.mjs`에 축 추가: `lens10-row-shape` = **모든** `[data-precedent]`에서 meta 상자 top ≥ head 상자 bottom(행마다 같은 2줄 구조 — 넘침 축이 못 보는 것, task#394 회고). 펼친 행에서 같은 점/다른 점 분리 여부(표지 있는 note일 때). 기존 `lens10-no-overflow` 유지.
  - 완료: 렌즈 10 표본이 있는 판에서 m278·m390·pc1440 ALL PASS + **스크린샷 육안 1장 이상(m390, 행 2개 이상 펼침)**.

## 완료기준 (DoD)
- `cd frontend && npx vitest run src/test/lens10.test.jsx` 통과(S1·S2 새 단언 포함).
  - 사전 상태: 6/6 통과 — 회귀 가드로서 정상. 새 단언은 아직 없다(S1·S2에서 추가 = 전진 검사).
- `grep -c "같은 점·다른 점 </span>" frontend/src/components/reports/LensReport.jsx` == 0.
  - 사전 상태: 1(전진 검사, 현재 실패가 맞다).
- `grep -c "같은 점: " scripts/cowork-routine-prompt.md API_SPEC.md CLAUDE_COWORK_API.md` 각 ≥ 1.
  - 사전 상태: 셋 다 0(전진 검사).
- `cd backend && .venv/bin/python -m pytest tests/test_api_doc_sync.py -q` 통과(문서 손댐 회귀 가드).
- 라이브: `scripts/uat369-lens-report.mjs` m278·m390·pc ALL PASS(렌즈 10 표본 ≥ 1 — 「표본 0 — 미검증」이면 통과로 치지 않는다) + 육안 스크린샷.
  - 검증 경로: dev 스택(`BASE=http://127.0.0.1:8084`)은 렌즈 10 이전 복사본이라 **전례 0건**(2026-10-21 확인). 머지 전 red→green이 필요하면 dev에 렌즈 10 판 1건을 확보한다(prod API GET → dev POST, dev는 prod 복사본이라 쓰기 무해). 확보가 막히면 머지 후 라이브(prod)에서 재고 그 사실을 기록한다.
  - 이 단언이 통과하면서도 깨질 수 있는 방식: 2줄 구조는 지켜도 **제목이 낱자로 쪼개지거나**(`keep-all` 누락) 배지·기간 줄이 좁은 폭에서 다시 넘어갈 수 있다 → 육안 스크린샷이 그 게이트다.

## 하지 않는 것
- `note`를 `same`/`diff` 두 필드로 나누는 계약 변경(검토 후 기각 — 범위 대비 이득 작음).
- 기존 발행물의 `note` 재작성·백필.
- 대상 위험 박스·기저율 막대·캡션의 디자인 변경(이번 제보 범위 밖).
- 기간 문자열 형식 통일(「2017-11~2018-09」 vs 「2018 하반기~2019」 — 루틴 데이터 문제, 별건).
- 사례 행 기본 펼침 상태 변경(접힘 유지).
