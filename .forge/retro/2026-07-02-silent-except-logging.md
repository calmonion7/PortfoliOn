# 2026-07-02 — silent except 로깅화 (task#127): kr.py·report_generator.py·stocks.py 무음 broad except 23곳에 logger.warning 추가

## Plan vs actual
- What went as planned:
  - 3파일 broad silent-swallow `except Exception:` **23곳**(stocks 6 / report_generator 9 / kr 8) 모두 de-silence. 계획 추정치 "~23"과 정확 일치.
  - 제어흐름 **byte-identical**: 각 hunk이 `except Exception:`→`except Exception as e:` + `logger.warning(f"...: {e}")` + (logger 없던 2파일) 모듈 로거 추가만. add-only를 2중 검증(워크플로우 verify 에이전트 `diff_add_only:true` + 메인 grep으로 비-except 제거 0건).
  - 회귀 0: baseline 982 passed/0 failed == verify 982 passed/0 failed.
  - 제외 대상 정확 준수(좁은 예외 ValueError/TypeError/KeyError, 재시도/re-raise, 기존 print 앵커·기존 logger 그대로).
- Divergences: 사실상 없음. 계획의 라인번호는 스냅샷이었고 편집으로 이동했으나, 실행 에이전트가 **Edit content-match + 특성 기반 재식별**로 정확히 대상만 수정(라인번호 무의존)해 문제 없음.

## Learnings
- Do differently next time:
  - **except 사이트를 fg-ask 그릴링 단계에서 미리 분류(broad-silent vs 좁은/재시도/이미-로깅)해 두면, 파일별 실행 에이전트가 정확한 맵을 받아 기계적 실행이 깨끗·저위험해진다.** 이번 성공 요인. 로그-only 스윕류(de-silence·가드 일반화)는 이 "사전 분류 → 파일별 병렬 + baseline/verify pytest 브래킷 + add-only diff 독립 리뷰" 워크플로우 형태를 재사용할 것.
  - **de-silence의 실효는 테스트 시점이 아니라 라이브/프로덕션 로그에서만 나타난다(deferred-verification-by-design, calendar/dividends 배치와 동일 계열).** 이번 게이트(pytest green + add-only)는 "제어흐름 불변·로그 추가됨"까지만 증명 — "숨은 버그가 실제로 드러나는가"의 최종 확인은 실패 발생 시 `docker logs portfolion-backend-1`에 `logger.warning`이 뜨는지로, 배포 후에만 가능. 후속에서 "테스트 green인데 왜 효과가 안 보이나"로 오해 말 것.
  - **배포 폴러 정밀 이해(재확인)**: `scripts/auto-deploy-poll.sh`는 `git rev-parse HEAD` == `origin/main`이면 **exit 0으로 skip**(reset 안 함). 즉 `HEAD==origin`인 상태의 순수 커밋-안-한 tracked 편집은 폴러에 **즉시 위험하지 않다** — 위험은 ① 누가 origin push로 SHA 진전 ② commit-only(push 안 함)로 LOCAL≠origin이 될 때뿐. 그래서 코드 영속·배포는 **commit+push를 함께**(commit-only는 다음 폴에 그 커밋 reset 소실). (CLAUDE.md 기존 gotcha의 정밀판 — 프로세스 노트로만, 문서 승급 불필요.)
- 후속 backlog 후보("전체가 두렵다"의 나머지 갈래): 나머지 백엔드 silent except(scraper·guru_scraper·investor_service·digest_service·us_supply·indices 등 CONCERNS §9), 프론트 silent catch(usePortfolioData 등), 거대 파일 분리(ADR-0017), 라이브 핫패스 characterization 테스트(안전망).

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (되돌리기 어려움+의외+실질 트레이드오프 3조건 미충족 — 로그 추가는 저위험 가역)
