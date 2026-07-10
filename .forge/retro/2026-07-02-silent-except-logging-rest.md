# 2026-07-02 — silent except 로깅화 (나머지, task#128): 백엔드 25파일 무음 broad except 54곳에 logger.warning 추가

## Plan vs actual
- What went as planned:
  - 대상 25파일 de-silence 완료. 신규 `logger.warning` **54곳**, 모듈 로거 **27파일** 배선(신규 25 + #127 stocks·report_generator 2). git diff `+logger.warning`=77(=#127 23+54)·`+logger=`27로 정합.
  - 제어흐름 **byte-identical**: 제거 라인은 `except Exception:`→`as e`와, `except Exception: pass` 4곳의 redundant `pass`가 `logger.warning`으로 대체된 것뿐(catch→로그→fallthrough, 기능 동일).
  - 회귀 0: baseline 982 passed == 최종(메인 직접 재실행) 982 passed. 제외 대상(좁은 예외·재시도·기존 print/logger) 준수. batch-backing은 log-only.
- Divergences (낮음):
  - **실적 54곳 vs 추정 ~56곳**: 2곳은 에이전트 근접 검토 시 non-target로 정당 스킵(Explore 라인 추정과 실제의 정상 오차).
  - **cache.py: 인벤토리 2곳 외 `_mc_delete` 3번째 broad-silent 사이트를 에이전트가 추가 발견·로깅**(hint를 지도로 사용 → 초과 달성).

## Learnings
- Do differently next time:
  - **기계적 스윕 워크플로우 템플릿이 스케일한다**: #127(3파일)에서 검증한 "baseline pytest → 파일별 병렬 에이전트(사전 Explore 인벤토리를 per-agent 맵으로) → verify(전체 pytest 회귀0 + add-only diff)" 형태가 25파일/56곳에 그대로 통했다. 사전 Explore 분류가 성패 요인 — 에이전트가 정확한 대상만 수정하고 인벤토리에 없던 사이트(_mc_delete)까지 잡았다. 다음 대규모 기계적 변경(가드 일반화·개명 등)에 재사용.
  - **add-only 검증은 "라인 제거 0"이 아니다**: `except Exception: pass` → `except ... as e: logger.warning(...)`는 redundant `pass`를 제거하는 게 정상(둘 다 두면 어색). 올바른 add-only 기준 = "제거되는 건 `except Exception:` 절(→as e)과, 로그로 대체된 redundant `pass`뿐; 반환값·fallback·구조 불변". 순진한 grep "비-except 제거 0"은 이 4건에 오탐 → 그 4건이 pass→warning 대체인지 육안 확인해 통과시켰다. 다음 스윕 검증 프롬프트에 이 규칙 명시.
  - **deferred-verification-by-design(재확인)**: 실효는 prod 로그에서만. pytest green은 "제어흐름 불변" 증명까지. 배포 후에야 숨은 실패가 `docker logs`에 뜬다.
  - CONCERNS §9(silent/broad except swallowing) 맵이 이제 대폭 stale(#127+#128로 ~79곳 de-silence) — 다음 fg-map 갱신 시 반영 필요(fg-done에서 제안 예정).
- 후속 backlog 후보: 프론트 silent catch(usePortfolioData 등), 거대 파일 분리(ADR-0017), 라이브 핫패스 안전망 테스트, batch-backing "빈 결과 캐시 박제 방지" 로직 강화(이번은 가시화만, 로직은 미변경).

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (log-only 가역 — 2회째지만 되돌리기 어려운 결정 아님; 반복 기계적 컨벤션은 retro/맵에 기록으로 충분)
