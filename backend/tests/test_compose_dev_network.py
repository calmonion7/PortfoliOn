"""공용 postgres 네트워크 taebro-db 에 붙는 서비스는 DB 주소를 environment 의 새 변수로 고정한다(task#387 회고 → task#388 ⑥-2 에서 개정).

taebro-db 에서는 taebro-postgres-1 이 별칭 `postgres` 를 가진다. 실행 자리 .env 의 옛 DATABASE_URL(호스트 `postgres` =
옛 portfolion-postgres-1, 기본 네트워크 portfolion_default)을 그대로 쓴 채 backend 를 taebro-db 에도 붙이면 `postgres` 가
어느 쪽으로 풀릴지 모호해져 에러 없이 엉뚱한 DB 를 볼 수 있다. 그래서 taebro-db 에 붙는 서비스는 environment 에서
`DATABASE_URL: ${PORTFOLION_DATABASE_URL:-}`(발급 DB, 호스트 taebro-postgres)로 덮어야 한다 — 옛 .env 의 키를 고치지 않는
이유는 헬스 실패 롤백이 실행 자리 비밀 파일을 되돌리지 않기 때문이다(taebro-infra docs/DB-MIGRATION.md 1-3).
"""
import subprocess
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
NET = "taebro-db"
DEV_OVERLAY = "deploy/dev-db.compose.yml"


def joins(doc):
    """compose 문서에서 NET 을 쓰는 서비스 이름 집합(최상위 networks 선언은 '<top>')."""
    doc = doc or {}
    hit = {
        name
        for name, svc in (doc.get("services") or {}).items()
        if NET in ((svc or {}).get("networks") or [])  # 목록·딕셔너리 둘 다 키로 검사된다
    }
    if NET in (doc.get("networks") or {}):
        hit.add("<top>")
    return hit


def load(rel):
    return yaml.safe_load((REPO / rel).read_text(encoding="utf-8"))


def test_detector_has_teeth():
    assert joins({"services": {"backend": {"networks": ["default", NET]}}}) == {"backend"}
    assert joins({"services": {"backend": {"networks": {NET: {}}}}}) == {"backend"}
    assert joins({"networks": {NET: {"external": True}}}) == {"<top>"}
    assert joins({"services": {"backend": {"networks": ["default"]}}}) == set()


PINNED = "${PORTFOLION_DATABASE_URL:-}"


def env_of(svc):
    env = (svc or {}).get("environment") or {}
    if isinstance(env, list):  # ["K=V", ...] 형식도 읽는다
        env = dict(e.split("=", 1) for e in env if "=" in e)
    return env


def unpinned(doc):
    """NET 에 붙는데 DATABASE_URL 을 environment 로 고정하지 않은 서비스."""
    svcs = (doc or {}).get("services") or {}
    return {n for n in joins(doc) - {"<top>"} if env_of(svcs[n]).get("DATABASE_URL") != PINNED}


def test_pin_detector_has_teeth():
    bad = {"services": {"backend": {"networks": ["default", NET]}}}
    good = {"services": {"backend": {"networks": ["default", NET], "environment": {"DATABASE_URL": PINNED}}}}
    listed = {"services": {"backend": {"networks": [NET], "environment": [f"DATABASE_URL={PINNED}"]}}}
    assert unpinned(bad) == {"backend"}
    assert unpinned(good) == set() and unpinned(listed) == set()


def test_base_compose_pins_db_url_on_taebro_db():
    doc = load("docker-compose.yml")
    assert "backend" in joins(doc), "⑥-2: prod backend 는 공용 postgres 망에 붙는다"
    assert unpinned(doc) == set()
    assert "postgres" not in (doc.get("services") or {}), "prod postgres 는 compose 밖(ADR 261011-074335 결정 1)"


def test_taebro_db_users_are_known():
    files = subprocess.run(
        ["git", "ls-files", "*compose*.yml", "*compose*.yaml"],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout.split()
    users = {f for f in files if joins(load(f))}
    assert users == {"docker-compose.yml", DEV_OVERLAY}
