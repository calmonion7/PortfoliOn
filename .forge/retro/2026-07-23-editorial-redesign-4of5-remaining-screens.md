# 2026-07-23 — 에디토리얼 리디자인 4/5: 나머지 화면(시장·캘린더·구루·설정·admin·로그인) (일괄 승급 사후 회고)

2026-07-17 실행·봉인(fg-next all auto-skip), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: marketUtils SectionCard 단일 수정으로 15개 섹션 전파(3파트 지렛대 패턴 반복), ConsensusSettings 인라인→공유 .seg, 로그인 SketchHero(sr-only 보존). 스모크 12/12, vitest 79 green.
- Divergences: ① (세션 한도) 1차 가동 6 에이전트 전부 rate-limit 실패 — 편집 0으로 죽어 무손상, `resumeFromRunId`로 무손실 복구(실전 첫 사용). ② (계획 오류) **GuruCrawlSettings.jsx·ReportSchedule.jsx는 존재하지 않는 파일명** — 계획이 CLAUDE.md의 옛 페이지 목록을 그대로 복사한 탓 → 현장 매핑(GuruCrawlNow·Settings 통합). ③ (리뷰 포착) PermissionManager 인라인 background가 신설 `.admin-row:hover`를 영구 무효화(인라인 > :hover) → 조건부 스프레드 + getComputedStyle 실측. ④ pc.css 죽은 CSS 발견(5파트 삭제 후보로 이월). ⑤ 스모크 포트 5175 지정이 CORS allowlist(5173)와 어긋났던 것 — 5173 사용.

## Learnings
- Do differently next time: **파트 계획에 적는 파일명은 작성 시점에 ls/glob으로 실검증** — 문서(CLAUDE.md 페이지 목록)는 드리프트할 수 있다(존재하지 않는 파일명 2건). **hover/상태 스타일을 CSS로 옮길 땐 같은 속성의 무조건부 인라인 지정이 남아있는지 확인**(인라인이 :hover를 영구 이김). 워크플로우 rate-limit 전멸은 `resumeFromRunId`로 무손실 복구 가능(편집 전 실패라면).

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none.
