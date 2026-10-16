<!-- forge-slug: listener-resume-and-enrich-run-check -->
<!-- task: 390 -->
<!-- tdd: on -->
# fire 리스너 재기동 이어받기 + enrich 회차 완료 데이터 대조 스크립트

## 목표 / 비목표
- 목표 (#389 회고 후속):
  - **A2** — 리스너가 재기동돼도 전량 회차의 남은 청크가 사라지지 않고 이어서 실행된다. 현재 큐(`_QUEUE`)는 프로세스 메모리에만 있어 재기동 때 남은 청크와 진행 위치가 소실된다.
  - **B1** — 회차 완료를 로그 줄이 아니라 DB 데이터(`job_runs.payload.tickers` × `tickers.enriched_at ≥ started_at`)로 판정하는 읽기 전용 스크립트를 둔다.
- 비목표:
  - 배포 스크립트의 재기동 지연(A1)은 하지 않는다. taebro-infra 공유 자원이라 이 레포 밖이다.
  - 리스너가 DB에 접근하게 하지 않는다. 이어받기에서 이미 갱신된 종목 건너뛰기(B2)는 하지 않고, 청크 하나의 중복 실행은 감수한다.
  - `claude` 실행기 경로, plist, 백엔드 `cowork_trigger`·`job_runs` 배선은 건드리지 않는다.
  - 단일 모드(`tickers` 없는 fire)는 이어받기 대상이 아니다. 기존대로 논블로킹 스폰이다.

## 결정 (그릴링 합의)
1. **이어받기 = 상태 파일.** 전량 회차를 받으면 `~/portfolion-routine-runs/` 아래 상태 파일 하나에 `text·tickers·model·chunk·done(완료 청크 수)·pid(실행 중 자식)`를 기록한다. 청크가 끝날 때마다 `done`을 갱신하고, 회차가 끝나거나 한도로 중단되면 지운다.
2. **끊긴 청크 처리 = 안 b.** 기동 시 상태 파일이 있으면 기록된 pid가 살아 있는 동안 기다린다(`_CHUNK_TIMEOUT` 상한). 세션 자식이 `start_new_session=True`라 리스너 재기동에도 살아남기 때문이다. 이후 끊긴 청크부터 다시 돌린다. pid는 청크 spawn **직후** 기록한다. spawn과 기록 사이의 창에서는 그 청크가 한 번 더 도는 쪽으로 기운다.
3. **B1 = 독립 읽기 전용 스크립트.** `scripts/`에 둔다. 형식은 `loopcheck-enrich-target-set.py`와 같다(`backend/.env`에서 DATABASE_URL, exit 0=전부 갱신 · 1=미갱신 종목 있음 · 2=환경·판정 불가, 미갱신 목록과 `n/N` 출력).

## 근거 자료
- 용어집: 없음. ADR: 없음 (되돌리기 쉬운 결정).
- 관련 코드: `scripts/cowork-fire-listener.py` (`_run_chunks`·`_worker_loop`·`_enqueue_chunks`), `backend/tests/test_cowork_fire_listener.py`, `scripts/loopcheck-enrich-target-set.py`.
- 관련 회고: `.forge/branch/dev/retro/261016-234500-routine-fire-claude-binary-pin.md`.

## 완료 정의 (DoD)
1. `cd backend && .venv/bin/python -m pytest -q tests/test_cowork_fire_listener.py` 전부 통과. 새 테스트 4건이 실재한다: ⓐ 청크 완료마다 상태 파일 `done` 갱신 ⓑ 상태 파일을 둔 채 새 프로세스 상태로 기동하면 남은 청크만 실행 ⓒ 기록된 pid가 살아 있으면 끝날 때까지 기다린 뒤 끊긴 청크부터 실행 ⓓ 회차 완료·한도 중단 시 상태 파일 삭제. ⓑⓒ는 구현 전 빨간불을 run.md에 기록한다.
   - 거짓 통과 방지: 큐가 메모리에만 있던 옛 동작에서 ⓑ·ⓒ가 반드시 실패해야 한다. 이어받기를 위해 일부러 상태 파일을 쓴 테스트와 쓰지 않은 대조군을 쌍으로 둔다.
2. `cd backend && .venv/bin/python -m pytest -q` 전체 green (사전 상태: 2558 passed — 회귀 가드).
3. B1 스크립트에 대한 테스트(`backend/tests/`, DB는 `services.db` mock — conftest `_block_real_db` 준수): 전부 갱신 → exit 0, 일부 미갱신 → exit 1과 미갱신 목록, DB 접근 실패 → exit 2.
   - 거짓 통과 방지: 갱신 시각이 `started_at` **이전**인 종목을 미갱신으로 읽는지 별도 케이스로 확인한다.
4. 라이브 대조(읽기 전용): 가장 최근 enrich 회차(2026-10-16 야간 수동 실행, 22종목)에 B1을 실행해 `22/22`, exit 0이 나온다. 사전 상태: 스크립트가 없어 실행 불가(순방향 확인).
5. 문서: `scripts/cowork-fire-listener.py` 모듈 docstring에 이어받기 규약(상태 파일 위치·pid 대기·중복 허용 근거)을 한 단락 추가한다. README·API 명세는 해당 없음(엔드포인트·화면·env·배치 무변경) — 확인 방법: `grep -n 'cowork-fire\|fire-listener' README.md API_SPEC.md CLAUDE_COWORK_API.md`의 히트를 읽고 이어받기와 무관함을 판정한다.
6. 배포 판정(PR 머지 후, 사람 몫): Deploy run `headSha`=머지 커밋 `conclusion=success`, `/usr/bin/grep -c '이어받' ~/runtime/portfolion/prod/scripts/cowork-fire-listener.py` ≥ 1, 리스너 로그에 배포 이후 `listening on 127.0.0.1:8787`.

## 작업 슬라이스
- [ ] S1. 이어받기 빨간불 테스트 작성 (DoD 1 ⓐ~ⓓ) — 완료 기준: ⓑⓒ 구현 전 실패를 run.md에 기록.
- [ ] S2. 리스너에 상태 파일 기록·갱신·삭제와 기동 시 이어받기(pid 대기 포함)를 구현한다 — 완료 기준: DoD 1·2 통과 (depends: S1)
- [ ] S3. B1 스크립트와 테스트 — 완료 기준: DoD 3 통과, DoD 4 라이브 대조 22/22.
- [ ] S4. 리스너 docstring 갱신과 문서 해당 없음 확인 — 완료 기준: DoD 5 (depends: S2)
- [ ] S5. 작업 브랜치 PR 생성(머지·배포는 사람 몫) — 완료 기준: PR 링크 제시 후 DoD 6은 머지 뒤 판정 (depends: S2, S3, S4)

## 깨질 수 있는 방식 (계획 시점 기록)
- 단언이 통과해도 pid 대기가 실제로는 안 돌 수 있다 → ⓒ는 살아 있는 더미 프로세스를 두고 대기 후에야 청크가 시작됨을 시간 순서로 단언한다.
- B1이 로그 줄 판정과 같은 거짓 음성을 낼 수 있다 → 시각 경계(`started_at` 이전 갱신) 케이스를 DoD 3에 넣었다.
