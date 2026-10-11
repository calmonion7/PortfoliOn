---
author: calmonion
decided: 2026-10-11 07:43
---
# 표준 배포(taebro-infra `bin/deploy`)로 전환 — 폴러·`deploy.sh` 은퇴, prod postgres는 ⑥-2까지 배포 compose 밖, 비밀 정본은 실행 자리

- 상태: 채택 (Accepted) — ADR `261009-105247`(배포 기록 SHA 대조·실패 1회·`deploy.sh` 종료코드 2/1)을 대체한다(superseded).
- 관련: task#386(⑥-1 1/2 prod), task#387(⑥-1 2/2 dev), taebro-infra 계약 v5(`~/runtime/taebro-infra/docs/CONTRACT.md`), ROLLOUT ⑥-1

배포 경로를 taebro-infra 계약 v5로 옮긴다. push(main → prod, dev → dev) → 러너가 `actions/checkout` → `~/runtime/taebro-infra/bin/deploy portfolion <env>`가 빌드·`:prev` 태그·`~/runtime/portfolion/<env>/`에서 compose 기동·헬스·자동 롤백을 맡는다. 그래서 launchd 폴러, `runner-deploy.sh`, `deploy.sh`, 부팅 잡(`start-docker-compose.sh`)과 배포 기록 파일(`~/.portfolion-deployed-sha`)은 은퇴한다. 재부팅 복구는 Docker Desktop 자동 시작 + `restart: unless-stopped`가 맡는다. 수동 재배포는 `gh workflow run deploy.yml --ref main`이다.

놀랄 만한 결정 셋:
1. **prod postgres(`portfolion-postgres-1`, 볼륨 `portfolion_pgdata`)는 배포 compose에 넣지 않는다.** `bin/deploy`는 매 배포 `up --force-recreate`라, 넣으면 배포마다 유일한 prod DB 컨테이너가 재생성된다. 컨테이너는 그대로 두고(compose는 orphan 경고만 하고 건드리지 않는다), 백엔드는 같은 네트워크 `portfolion_default`에서 `postgres:5432`로 붙는다. 정의는 `deploy/legacy-postgres.compose.yml`에 보존한다(사람 수동 재생성용). ⑥-2(공용 `taebro-postgres` 이전)에서 없어진다.
2. **prod 비밀의 정본은 `~/runtime/portfolion/prod/.env`이고, `backend/.env.docker`는 그것을 가리키는 심링크다.** 보조 스크립트 6개(`cowork-fire-listener.py` 토큰 대조 등)가 `backend/.env.docker`를 직접 읽으므로, 두 벌로 두면 회전·교체 때 한쪽만 바뀐다. 이동+심링크는 스크립트 무수정으로 단일 정본을 만든다.
3. **dev 스택은 외부 키를 갖지 않고 스케줄러가 꺼진다**(`SCHEDULER_ENABLED=false`). dev DB는 prod 복사본이라 배치 스케줄이 그대로 들어 있고, 키가 있으면 키움·KIS 토큰 재발급(prod 토큰 무효화)과 루틴 발사가 dev에서 일어난다. 프롬프트·관례가 아니라 키 부재로 구조적으로 막는다.

검토한 대안: postgres를 compose에 남김(배포마다 DB 재생성 — 기각) · 비밀 두 벌 + 문서로 동기(drift 자리 — 기각) · 보조 스크립트 6개를 runtime 경로로 수정(표면만 넓음 — 기각) · `deploy.sh`를 비상 수동 경로로 존치(컨테이너 정의 두 벌, 실행하면 라벨 없는 컨테이너로 회귀 — 기각).
