# 도커 스택 자동기동 (`com.portfolion.docker-compose`)

부팅 시 PortfoliOn 스택을 자동 기동하는 launchd 잡. **컨테이너가 *제거된* 상황에서의 복구**를 담당한다
(평시 재기동은 각 컨테이너의 `restart: unless-stopped` 가 처리하므로 이 잡과 무관하다).

## 구성

| 무엇 | 어디 |
|---|---|
| 기동 스크립트 (정본) | `scripts/start-docker-compose.sh` |
| plist 정본 | `scripts/com.portfolion.docker-compose.plist` |
| 설치 위치 | `~/Library/LaunchAgents/com.portfolion.docker-compose.plist` |
| 로그 | `~/Library/Logs/com.portfolion.docker-compose.{out,err}.log` |

## 기동 범위 — 왜 `docker compose up -d` 전체가 아닌가

이 스택은 관리 주체가 둘이다(실측, `com.docker.compose.service` 라벨로 확인):

- **compose 소유**: `postgres` · `certbot`
- **`deploy.sh` 소유**: `backend` · `nginx` (`docker run`)

그런데 `deploy.sh` 가 쓰는 컨테이너 이름이 compose 의 것과 **같다**
(`portfolion-backend-1` / `portfolion-nginx-1`). 그래서 compose 를 통째로 올리면
`deploy.sh` 가 만든 그 둘을 compose 정의로 재생성해 버린다.
→ 스크립트는 `docker compose up -d postgres certbot` 후 `bash deploy.sh` 순으로 돈다.

## 적용 절차 (사용자 실행)

```bash
# 0) 원본 백업 — 롤백의 전제다. 먼저 할 것.
cp ~/Library/LaunchAgents/com.portfolion.docker-compose.plist \
   ~/Library/LaunchAgents/com.portfolion.docker-compose.plist.bak

# 1) 정본 배치
cp /Users/calmonion/Project/PortfoliOn/scripts/com.portfolion.docker-compose.plist \
   ~/Library/LaunchAgents/com.portfolion.docker-compose.plist

# 2) 재적재
launchctl bootout  gui/$(id -u)/com.portfolion.docker-compose 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.portfolion.docker-compose.plist

# 3) 1회 수동 실행 (= postgres 재생성 → 127.0.0.1:5432 바인딩이 여기서 실제 적용된다)
launchctl kickstart -k gui/$(id -u)/com.portfolion.docker-compose

# 4) 결과 확인 — 이 값이 0 이어야 성공
launchctl list | awk '$3=="com.portfolion.docker-compose"{print "exit="$2}'
```

**3) 은 무엇을 하는가** — `docker compose up -d postgres certbot` 이 postgres 를 **재생성**하고
(`docker compose up --dry-run` 으로 확인: `postgres Recreate`, certbot 은 `Running` 유지),
이때 `docker-compose.yml` 의 `127.0.0.1:5432:5432` 가 비로소 실행 중 컨테이너에 적용된다.
이어서 `deploy.sh` 가 backend·nginx 를 재생성한다(수십 초 다운타임).

**데이터는 보존된다** — `/var/lib/postgresql/data` 는 named volume `portfolion_pgdata` 이고
컨테이너 재생성과 수명이 분리돼 있다(실측). `docker-entrypoint-initdb.d` 의 SQL 은
데이터 디렉터리가 비었을 때만 실행되므로 기존 DB 를 건드리지 않는다.

## 롤백

```bash
launchctl bootout gui/$(id -u)/com.portfolion.docker-compose 2>/dev/null || true
cp ~/Library/LaunchAgents/com.portfolion.docker-compose.plist.bak \
   ~/Library/LaunchAgents/com.portfolion.docker-compose.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.portfolion.docker-compose.plist
```

⚠️ 되돌리면 잡은 다시 **exit 127** 상태가 된다(옛 plist 가 삭제된 워크트리 경로를 가리키므로).
즉 롤백은 「고장난 원상태로 복귀」이지 정상 상태가 아니다 — 컨테이너 자체는
`restart: unless-stopped` 로 계속 살아 있다.

## 검증 명령

```bash
launchctl list | awk '$3=="com.portfolion.docker-compose"{print $2}'   # 0 이어야 함
docker ps --format '{{.Names}} {{.Ports}}' | grep portfolion-postgres  # 127.0.0.1:5432 여야 함
nc -z -G 2 172.16.11.230 5432                                          # 거부되어야 함
docker ps --format '{{.Names}}' | grep -c portfolion                   # 4
curl -s -o /dev/null -w '%{http_code}' http://localhost/health          # 200
tail -20 ~/Library/Logs/com.portfolion.docker-compose.out.log           # 단계별 타임스탬프 로그
```
