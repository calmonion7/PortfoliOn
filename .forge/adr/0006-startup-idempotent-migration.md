# 추가 컬럼은 기동 시 idempotent 마이그레이션(`ADD COLUMN IF NOT EXISTS`)으로 적용한다

이 프로젝트는 별도 마이그레이션 프레임워크가 없고 `app_schema.sql`을 **매 배포 재실행하지 않으므로**, 기존 테이블에 컬럼을 추가해도 운영 DB에는 반영되지 않는다. 게다가 운영 postgres에 대한 직접 접근(`docker exec`/외부 DSN mass-write)은 안전 가드로 차단되어, 사람이 수동으로 `ALTER TABLE`을 칠 경로도 사실상 막혀 있다. 그래서 **추가 컬럼(additive) 마이그레이션은 `main.py`의 lifespan에서 `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`를 기동 시 실행**(`_migrate()`)해 배포가 자동·idempotent하게 적용하도록 한다(예: `backlog_history.segments JSONB`). 앱은 마이그레이션이 끝난 뒤에야 요청을 받으므로(lifespan yield 이전), 신코드가 새 컬럼을 SELECT/INSERT해도 안전하다.

## Considered Options
- **수동 `ALTER TABLE`(docker psql)** — 기각. 운영 postgres 직접 접근이 가드로 차단되고, 배포마다 사람 개입이 필요해 누락 위험.
- **마이그레이션 프레임워크(Alembic 등) 도입** — 기각(현 단계 과함). 추가 의존성·러너 배선 비용이 additive 컬럼 한두 개에 비해 과도.
- **기동 시 `ADD COLUMN IF NOT EXISTS`** — 채택. 가볍고 idempotent하며 배포로 자동 적용.

## Consequences
- **additive(컬럼 추가)·idempotent DDL에만 한정.** 파괴적 변경(drop/rename/type 변경·백필)은 이 경로로 하지 말 것 — 기동마다 실행돼도 안전한 연산만 허용.
- 매 부팅 DDL이 한 번씩 도는 게 의외로 보일 수 있어(프레임워크 부재) 본 ADR로 의도를 남긴다.
- `app_schema.sql`에도 같은 컬럼을 정의해 **신규 DB(초기화)와 기존 DB(기동 마이그레이션)** 양쪽을 일치시킨다.
- **신규 테이블(CREATE TABLE)도 동일하게 `main._migrate()`에 `CREATE TABLE IF NOT EXISTS`로 넣어야 한다.** `app_schema.sql`은 docker-entrypoint-initdb.d에 마운트돼 **빈 pgdata 최초 초기화 때만** 실행되므로, 거기에만 추가한 테이블은 **이미 채워진 기존 운영 DB에는 절대 생기지 않는다.** 신코드(스케줄러 시딩·라우트)가 그 테이블을 SELECT하면 `relation does not exist`로 lifespan startup이 실패해 백엔드 부팅이 막힌다. 이 프로젝트가 반복적으로 겪은 함정(task #16 configurable-batch-schedules의 `batch_schedules`에서 critical로 재현; 과거 task들의 "DB 수동 적용 필요"도 같은 뿌리). 컬럼이든 테이블이든 **신규 스키마는 `main._migrate()` 런타임 IF NOT EXISTS가 정본**이고, `app_schema.sql`은 신규 DB 일치용 미러일 뿐이다.
