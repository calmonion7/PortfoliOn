# 호스트 127.0.0.1:5432 (portfolion-postgres-1) 사용처 조사

조사일 2026-10-10, 읽기 전용(task#384 S5). 목적: 서버 통합 ⑥ 「공용 postgres 이전」 때 호스트 포트 5432를 보고 접속하는 곳을 빠짐없이 고치기 위한 체크리스트.
`docker-compose.yml`이 `127.0.0.1:5432:5432`로 게시한다(루프백 전용). DB명 `portfolion`, 사용자 `portfolion`. 비밀번호·접속 문자열은 이 문서에 적지 않는다.

분류: 「이전 시 고칠 것」 / 「은퇴」 / 「그대로」.

## ① 레포 안

| 항목 | 위치 | 연결 방식 | 분류 | 근거 |
|---|---|---|---|---|
| 로컬 venv·pytest·스크립트 DSN | `backend/.env` (`DATABASE_URL`) | `postgresql://portfolion@localhost:5432/portfolion` (호스트 포트 경유, 비밀번호 포함은 파일에만) | 이전 시 고칠 것 | 호스트 5432 직접 사용. 새 호스트/포트로 갱신 필요 |
| 테스트 DB 차단 가드 | `backend/tests/conftest.py` `_block_real_db` | 로컬 `DATABASE_URL`이 라이브 DB를 가리킨다는 전제로 DB 접근을 raise로 차단 (URL 하드코딩 없음) | 그대로 | URL 무관하게 `services.db`를 막는다. 이전 후에도 유효 |
| 컨테이너 백엔드 DSN | `backend/.env.docker` | 도커 네트워크 별칭 `postgres:5432` (컨테이너↔컨테이너, 호스트 5432 아님) | 이전 시 고칠 것 | 호스트 포트는 안 쓰지만 공용 postgres로 가면 호스트명·네트워크 변경 필요 |
| 일회성 백필 | `backend/run_backfill.py` | `host=localhost port=5432` DSN을 소스에 하드코딩 (비밀번호도 소스에 박혀 있음) | 은퇴 | 일회성 호스트 스크립트. 이전 전에 삭제하거나 `DATABASE_URL` 환경변수로 교체 권장(하드코딩 크리덴셜 별건) |
| enrich 대상 집합 루프체크 | `scripts/loopcheck-enrich-target-set.py` | `backend/.env`의 `DATABASE_URL`을 읽어 psycopg2 직접 연결 | 이전 시 고칠 것 | `.env`만 고치면 따라옴 |
| 측정 스크립트 | `scripts/task351_measure.py` | `backend/.env`의 `DATABASE_URL`을 읽음 | 이전 시 고칠 것 | 동일 |
| OAuth 핸들러 벤치 | `scripts/uat289-oauth-handler-bench.py` | 환경변수 `DATABASE_URL` | 이전 시 고칠 것 | 호출자가 주는 값. 일회성 UAT라 은퇴 후보 |
| 비밀번호 회전 | `scripts/rotate-postgres-password.sh` | `docker exec portfolion-postgres-1 psql`(컨테이너 내부) + 별칭 `postgres` 경유 검증, `.env`·`.env.docker` 갱신 | 이전 시 고칠 것 | 컨테이너명·별칭·두 env 파일 경로가 이전 후 달라진다 |
| `docker exec portfolion-postgres-1 psql` 계열 | `scripts/ab-publish.py` · `scripts/ab-summary.py` · `scripts/enrich-ab.py` · `scripts/loopcheck-enrich-on-demand-live.mjs` · `scripts/uat291-mutation-ownership.mjs` · `scripts/uat289-oauth-callback-latency.mjs` · `scripts/uat347-holiday-skip.mjs`(출력 안내문) | 호스트 5432가 아니라 컨테이너 이름으로 exec | 이전 시 고칠 것 | 5432 포트 무관, 컨테이너명 `portfolion-postgres-1`·DB명 하드코딩. 이전 후 컨테이너가 사라지면 깨짐 (A/B·UAT 일회성은 은퇴 후보) |
| 도커 자동기동 점검 | `scripts/apply-docker-autostart.sh` (C9·C10), `scripts/README-docker-autostart.md` | 게시 포트가 `127.0.0.1:5432`인지, LAN IP의 5432가 거부되는지 검사 | 이전 시 고칠 것 | 포트 게시가 없어지면 C9가 FAIL. 검사 항목 자체를 수정·삭제 |
| 배포 스크립트 | `deploy.sh` · `scripts/auto-deploy-poll.sh` · `scripts/runner-deploy.sh` | 5432·DATABASE_URL 참조 없음(grep 0건) | 그대로 | 해당 없음 |
| 문서 | `docs/*.md`·`README.md` | 5432 안내 0건. `docker-compose.yml:13-15` 주석만 5432 서술 | 이전 시 고칠 것 | compose 포트 게시·주석은 이전 시 같이 정리 |

## ② 레포 밖

| 항목 | 위치 | 연결 방식 | 분류 | 근거 |
|---|---|---|---|---|
| launchd plist 4종 | `~/Library/LaunchAgents/` (`com.portfolion.auto-deploy-poll`·`com.portfolion.docker-compose`·`com.portfolion.cowork-fire-listener`·`actions.runner.calmonion7-PortfoliOn.macbook-portfolion`) | 5432·postgres·DATABASE 문자열 없음(grep 0건) | 그대로 | DB에 직접 접속하지 않는다. `/Library/LaunchAgents`·`/Library/LaunchDaemons`에는 해당 plist 없음 |
| `~/portfolion-backups/` | `analyst_reports-20261007-before-v1-purge.sql` | 덤프 파일(접속 아님) | 그대로 | 정적 백업 |
| `~/portfolion-ab/`, `~/portfolion-routine-runs/` | 데이터·로그 산출물 | 스크립트 없음, 접속 없음(루틴 로그의 문자열 일치뿐) | 그대로 | 산출물 |
| `~/bin`, `~/scripts` | 존재하지 않음 | - | 그대로 | - |
| FitCheck | `~/Project/FitCheck/docker-compose.yml` 주석 | 「5432는 portfolion이 점유, 자체 DB는 호스트 미노출」이라는 설명만 | 그대로 | 접속 아님. 5432를 비우면 주석만 낡음 |
| lab-taebro | `.forge/reports/261010-*.md` | 이 조사를 요청한 통합 문서(접속 아님) | 그대로 | - |

타 프로젝트 중 이 DB에 실제 접속하는 곳은 발견되지 않았다.

## ③ 라이브 (2026-10-10 조회)

`pg_stat_activity`(client backend) 2행.

| 항목 | 위치 | 연결 방식 | 분류 | 근거 |
|---|---|---|---|---|
| 백엔드 컨테이너 | client_addr 172.19.0.2 (`portfolion-backend-1`), usename portfolion, idle | 도커 네트워크 `portfolion_default`(172.19.0.0/16) | 이전 시 고칠 것 | 유일한 상주 클라이언트. `.env.docker` 변경 대상 |
| 조사용 psql | client_addr 비어 있음(컨테이너 내부 유닉스 소켓), 조사 쿼리 자신 | `docker exec` | 그대로 | 일시적 |
| 호스트 경유(게이트웨이 172.19.0.1) | 0건 | - | - | 조회 시점에 5432 포트로 들어온 호스트 프로세스 없음 |

`lsof -nP -iTCP:5432`: Docker 데스크톱 포워더(`com.docker` PID 1039)의 `127.0.0.1:5432 LISTEN` 1건뿐, ESTABLISHED 없음. 한 시점 스냅샷이므로 간헐 사용(스크립트·pytest 실행)은 ①의 정적 목록으로 판단해야 한다.

## 이전 체크리스트

1. `backend/.env.docker`의 `DATABASE_URL`을 공용 postgres 호스트/DB로 교체하고 컨테이너 네트워크 연결(별칭 `postgres`) 확인.
2. `backend/.env`(로컬 venv·pytest·loopcheck·task351)의 `DATABASE_URL` 갱신. `_block_real_db`는 그대로 둔다.
3. `docker exec portfolion-postgres-1 …` 하드코딩 스크립트(A/B·UAT·loopcheck)는 컨테이너명이 바뀌면 깨지므로 은퇴하거나 대상 컨테이너·DB명을 갱신.
4. `scripts/rotate-postgres-password.sh`의 컨테이너명·별칭·env 경로 갱신.
5. `scripts/apply-docker-autostart.sh` C9·C10과 `scripts/README-docker-autostart.md`, `docker-compose.yml`의 5432 게시·주석 정리.
6. `backend/run_backfill.py` 은퇴(또는 env 기반으로). 소스에 박힌 크리덴셜은 별건으로 정리.
7. 이전 후 `lsof -nP -iTCP:5432`·`pg_stat_activity`로 호스트 경유 접속 0건 재확인, 5432 게시 제거.
