"""prod 와 dev 가 같이 쓰는 기본 compose 는 공용 postgres 네트워크 taebro-db 에 붙지 않는다(task#387 회고).

taebro-db 에서는 taebro-postgres-1 이 별칭 `postgres` 를 가진다. prod backend 가 그 네트워크에도 붙으면
prod DATABASE_URL 의 호스트 `postgres` 가 prod DB(portfolion_default)와 공용 DB 중 어느 쪽으로 풀릴지
모호해진다 — 에러 없이 엉뚱한 DB 를 볼 수 있다. dev 는 실행 자리 .env 의 COMPOSE_FILE 로만
deploy/dev-db.compose.yml 을 덧붙여 붙는다. ⑥-2(prod 를 공용 DB 로 이전)에서 이 테스트를 의도적으로 고친다.
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


def test_base_compose_never_joins_taebro_db():
    assert joins(load("docker-compose.yml")) == set()


def test_only_dev_overlay_uses_taebro_db():
    files = subprocess.run(
        ["git", "ls-files", "*compose*.yml", "*compose*.yaml"],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout.split()
    users = {f for f in files if joins(load(f))}
    assert users == {DEV_OVERLAY}
