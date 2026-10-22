# 2026-10-23 — 시장지표 「반도체」 카드(SOX + DRAMeXchange 메모리 현물가·Wayback 1년 백필) (task#403, fg-loop → 일괄 승급)

## 계획 vs 실제
- 계획대로 된 것: S1 파서(6분류 23종, 복합키 `<item>:<type>`로 1월·10월 스냅샷 id 일치), S4 SOX, 병렬 워크플로우 10 에이전트 오류 0, 적대 검토가 DB 읽기 실패 → 「없음」 붕괴(graceful `_mc_load`)를 배포 전에 포착.
- 어긋난 것:
  - **S2 계약 외 보강이 백필과 충돌(r1)** — 「이번 페이로드에 없는 품목은 직전값 유지」가 소스의 단종(목록 제외)을 누락으로 읽었고, 백필이 옛 스냅샷 품목을 들여와 현재 표 23 → 28종(1년 전 값). 배치 단독 테스트로는 원리적으로 안 보이고 두 번째 writer(백필)가 붙어야 발현.
  - **프로브가 같은 결함을 통과시킴** — `rows-count`가 기대치를 같은 API에서 유도해 `dom=28 api=28` PASS. 잡은 것은 계획 리터럴(23)을 박은 정지조건 C5.
  - **Wayback 레이트리밋(r2)** — 1초 간격(분당 ~60회)이 IA 한도(~15회) 초과로 134건 중 116건 `Connection refused`, 이력 18점. 5초 + 60초 쿨다운 1회 재시도로 132건.
  - **육안 7번째(r3)** — m360 X축 틱 라벨 겹침(minGap −2.2px)을 42축 ALL PASS 프로브가 못 봄. IndexSection과 같은 `interval` 고정값이 카드 한 겹 더 깊은 중첩에서 여유를 잃음.
  - **멱등 판정 기준** — 계획 DoD 6 「재실행 시 점 수 불변」이 실측 +1(1차에서 건너뛴 스냅샷이 2차에 수신돼 새 날짜 채움, 중복 0). 비결정적 외부 입력 위의 멱등은 개수가 아니라 「같은 키 중복 0 · 같은 입력 재병합 불변」으로 써야 했다.
  - **모호한 고정 계약** — 「indices에 sox, 기존과 같은 형태」 문구로 S5가 `indices.sox ?? sox` 이중 폴백을 만들었고, 테스트 목이 틀린 형태(`{data:{sox}}`)여도 폴백 덕에 통과(메인 통합에서 폴백 제거 → 목이 즉시 FAIL해 드러남).
  - 재계획 상한 3을 S7 UAT 보수로 전부 사용(정지조건이 아니라 태스크 UAT가 3번 실패한 것).

## 학습
- 다음엔 다르게:
  - 증분 저장에 **백필 경로를 더할 땐** 「옛 스냅샷에만 있는 키가 현재 집합에 들어오는가」를 착수 시 테스트로 못박을 것(계약에 「현재 목록 = 최신 페이로드 구성원」을 명시).
  - 외부 아카이브·크롤 백필은 **대상의 레이트리밋을 착수 시 확인**하고 간격을 그 아래로(IA는 분당 ~15회, 넘으면 수 분간 연결 거부). 백필 결과의 병합/건너뜀 수는 job_runs payload에 실어 관측 가능하게.
  - 프로브의 화면↔API 대조와 별개로 **API 절대량을 소스 독립 리터럴과 대조하는 축**을 정지조건에 둘 것.
  - 기존 차트의 축 설정을 복사할 땐 **컨테이너 중첩 깊이**가 같은지 볼 것 — 시각 변경은 프로브 PASS 후에도 m360 육안 필수(이번에도 유일한 포착 수단).
  - 멱등 DoD는 「개수 불변」이 아니라 「같은 키 중복 0 / 같은 입력 재병합 불변」으로 쓸 것(외부 수신이 비결정적이면 개수는 늘 수 있다).
  - 병렬 슬라이스에 고정하는 계약은 「기존과 같은 형태」가 아니라 **정확한 응답 경로·키**로(`data.indices.sox`) — 모호하면 이중 폴백이 생겨 목 드리프트를 가린다.
  - 범위 밖 잔존: `IndexSection` 차트도 같은 고정 6틱(m360 겹침 미측정), API_SPEC indices의 「`indices_fetch` 일배치」 서술과 backend/CLAUDE.md 「요청경로 증분」 모순.

## 문서 갱신
- CONTEXT.md 승급: 없음(용어 [[메모리 현물가]]는 그릴링 때 이미 `.forge/branch/dev/CONTEXT.md`에 신설)
- ADR 추가: 없음
- 가토 승급(사용자 선호 없음 → 재발 가능성이 구조적인 2건만): `backend/services/CLAUDE.md` 「직전값 보존은 값에, 목록 구성원에는 걸지 말 것」 · `.claude/skills/live-uat-probes` ㉦ API 유도 기대치의 API 결함 블라인드 · ㉧ 중첩 카드의 고정 interval 틱 겹침 + 기하 틱 축
- eval: 보수 중 인라인 추가 — `test_item_dropped_by_newer_snapshot_is_hidden_but_history_kept` · `test_backfill_only_item_never_listed_in_current_table` · `test_backfill_paces_under_wayback_rate_limit_and_retries_refused` · refresh 카운트 stale 제외 단언 · uat403 `x-ticks-no-overlap`
- 승급 보류(회고 로그만): 멱등 판정 기준(verification-gates 후보), 모호한 고정 계약 → 이중 폴백(subagent-orchestration 후보)
