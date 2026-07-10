# 2026-07-09 — 로깅 방출 규약 정본화 + main.py basicConfig (task#162, part 1/2)

## Plan vs actual
- What went as planned:
  - S1 CONVENTIONS.md §4 "로깅 방출 규약"(메커니즘·레벨·포맷·노이즈 4요소), S2 CLAUDE.md 포인터 gotcha, S3 `main.py:_configure_logging()`(basicConfig INFO + 노이즈 lib WARNING 억제) 모두 완료.
  - 로컬 검증: pytest 1229 passed(회귀 0), TestClient 경유 main.py import 정상. commit 60c542d push.
  - 규모가 작아 workflow 없이 메인 세션 직접 실행(fg-run Constraints 준수).
- Divergences:
  - **계획 초과(스코프 내)**: grilling에서 flag한 "basicConfig root 핸들러 ↔ uvicorn 로거 double-emit" 위험을 방어하려 `uvicorn`/`uvicorn.error`/`uvicorn.access` `propagate=False` 선제 추가. 포맷은 asctime 생략(docker 타임스탬프 중복 회피).
  - **회고 시점 발견 — CONVENTIONS §4가 조용히 사라졌다가 재추가**: fg-run에서 Edit로 추가한 §4가 이후 외부 linter/watcher에 의해 되돌려져(파일이 148줄 원상복구, §4 소실) 회고 시점에 없어진 것을 발견 → 재추가하고 지속 확인(171줄). Edit 성공 직후 "modified by linter" system-reminder가 원본을 보여준 것이 revert였던 것으로 추정.

## Learnings
- Do differently next time:
  - **`.forge/codebase/` map 문서(untracked)는 외부 linter/watcher가 세션 중 조용히 되돌릴 수 있다** — Edit가 성공해도 "디스크에 남았다"를 가정하지 말고, map 문서 편집 후엔 grep/wc로 **지속 여부를 재확인**할 것. (poller `reset --hard`는 untracked 미대상이므로 이건 poller가 아니라 별개 linter류 동작.) 이번엔 회고 대조 중 우연히 포착 — 만약 안 봤으면 규약 문서가 통째 유실될 뻔.
  - 로깅 config는 코드 자체는 저위험·가역이나 **실효는 prod docker-logs에서만**(deferred-verification-by-design) — 로컬 pytest green은 "import·제어흐름 불변"까지만 증명.
- 후속: Part 2(print→logger 전수 스윗)가 이 규약을 적용. prod 배포 후 docker logs에서 INFO 가시·uvicorn 미중복 실측 확인 권장.

## Doc updates
- CONTEXT.md promotion: none (구현 규약이라 도메인 용어 아님)
- ADR added: none (log-only·가역 — `2026-07-02` 회고 선례대로 ADR 3조건 미충족)
- 기타: CONVENTIONS.md §4 신설(map 문서, fg-run 산출) + 회고 중 유실 재추가.
