# 2026-06-13 — 리팩토링 안전 3건: 프론트 번들 스플리팅·마이그레이션 로깅·데드코드 제거 (task 28)

## Plan vs actual
- What went as planned:
  - 동작 보존형 안전 3슬라이스 전부 완료(직접 처리, 워크플로우 미사용). S1 번들 스플리팅(단일 ~990KB → charts 412/vendor 255/index 300, >500KB 경고 해소), S2 `_migrate` 실패 로깅(부팅 비차단 유지), S3 `save_schedule()` 데드 함수 제거(`get_schedule()`은 사용 중이라 보존).
  - backend 466 passed, 라이브 로드 UAT(/, /market[recharts], /research[markdown]) ROOT 마운트·JS/런타임 에러 0.
- Divergences:
  - **`manualChunks` 객체형 → 함수형 (Vite 8/rolldown)**: 객체 형식으로 1차 빌드 실패("Invalid type: Expected Function but received Object" → `TypeError: manualChunks is not a function"). **Vite 8은 rollup이 아니라 rolldown 번들러를 쓰며, rolldown의 `output.manualChunks`는 함수만 받는다(객체 매핑 미지원).** id 기반 함수형(`charts`/`markdown`/`vendor` 버킷)으로 교체해 해결.
  - **markdown 전용 청크 미생성**: 함수 매처가 react-markdown 트랜지티브 의존성을 `vendor`/`index`로 흡수. 목표(monolith 분할·>500KB 해소)는 달성이라 무해.

## Learnings
- Do differently next time:
  - **Vite 8 프로젝트에서 청크 분할 시 `manualChunks`는 처음부터 함수형으로 작성**할 것 — Vite 7까지의 rollup 객체형(`{name: [pkgs]}`) 예시를 그대로 쓰면 rolldown에서 빌드가 깨진다. 이 repo는 `vite ^8.0.10`(rolldown) 사용.
  - 함수형 `manualChunks`는 **트랜지티브 의존성까지 id substring으로 잡아야** 의도한 청크가 생긴다(react-markdown처럼 remark/rehype/micromark/mdast/hast/unist… 생태계가 큰 경우 매처 누락 시 vendor로 흡수됨). 거대 단일 의존성(recharts+d3) 분리만으로도 monolith 해소 목표는 충분.
  - 번들 청킹 변경의 UAT는 "빌드 성공"으로 끝내지 말 것 — 잘못된 청킹은 **런타임 청크 로드 에러/흰 화면**을 내므로, 라이브에서 실제 페이지 로드 + 콘솔/페이지 에러 0을 확인(Playwright)해야 완결.

## Doc updates
- CONTEXT.md promotion: none (rolldown/manualChunks는 빌드 툴링·구현 사실 — 도메인 글로서리 항목 아님)
- ADR added: none (되돌리기 어려운 트레이드오프 결정이 아니라 툴링 제약 대응 — ADR 3조건 미충족)
- 후속 후보(별도 doc 작업): "Vite 8 = rolldown, manualChunks 함수형" 함정을 `CLAUDE.md` Gotchas / `.forge/codebase/STACK.md`에 한 줄 남기면 재발 방지.
