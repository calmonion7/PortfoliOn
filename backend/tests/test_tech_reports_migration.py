"""tech_reports 판 누적 폐기 마이그레이션 (ADR-0038, task#299).

main._migrate가 과거 행 삭제 + UNIQUE(slug, published_date) → UNIQUE(slug) 전환 DDL을
이 순서로 발행하는지 못박는다(형태 단언 — conftest _block_real_db가 실 DB를 차단하므로
services.db.execute를 mock).
"""


def test_migrate_drops_old_constraint_and_creates_unique_slug_index(monkeypatch):
    import main
    ddl = []
    import services.db as db
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()
    joined = "\n".join(ddl)

    assert "DROP CONSTRAINT IF EXISTS tech_reports_slug_published_date_key" in joined
    assert "CREATE UNIQUE INDEX IF NOT EXISTS tech_reports_slug_key ON tech_reports (slug)" in joined

    drop_idx = joined.index("DROP CONSTRAINT IF EXISTS tech_reports_slug_published_date_key")
    create_idx = joined.index("CREATE UNIQUE INDEX IF NOT EXISTS tech_reports_slug_key ON tech_reports (slug)")
    assert drop_idx < create_idx


def test_migrate_retires_data_center_surgically(monkeypatch):
    """은퇴 slug 삭제는 반드시 그 slug만 지운다 (ADR-0039 결정 1, task#301).

    이 DELETE는 발행물을 지우는 데이터 손실 경로다. 「TECH_TOPICS 밖 전부 삭제」 같은 일반형으로
    개작되면 나중에 누가 slug를 일시적으로 빼는 순간 그 발행물이 조용히 증발하는데, 라이브에서만
    드러나고 되돌릴 수 없다. 그래서 형태를 테스트로 못박는다 — DoD의 기동 로그 확인은 1회성이라
    이후 리팩터를 지키지 못한다(적대 리뷰 렌즈2 test-coverage-gap).
    """
    import main
    import services.db as db

    ddl = []
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()

    deletes = [s for s in ddl if "DELETE" in s.upper() and "tech_reports" in s]
    retire = [s for s in deletes if "data-center" in s]
    assert len(retire) == 1, f"은퇴 DELETE가 정확히 1개여야 한다: {deletes}"
    assert "WHERE slug = 'data-center'" in retire[0]

    # 일반형 금지 — slug 목록/부정 조건으로 쓸어담는 형태가 아님을 못박는다.
    banned = ("NOT IN", "!=", "<>", "NOT LIKE")
    assert not any(b in retire[0].upper() for b in banned), f"일반형 삭제 금지: {retire[0]}"


def test_migrate_and_schema_both_declare_composition_column(monkeypatch):
    """신규 컬럼은 `app_schema.sql`과 `main._migrate` **양쪽**에 있어야 한다 (CLAUDE.md 컬럼 추가 DoD).

    스키마 파일은 신규 설치용이고 라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다 —
    한쪽만 고치면 배포 직후 그 컬럼을 쓰는 INSERT가 컬럼 부재로 깨진다(task#130 실사례).
    그래서 두 파일을 한 테스트에서 함께 단언한다(한쪽만 고치면 여기서 실패해야 한다).
    """
    import pathlib
    import main
    import services.db as db

    ddl = []
    monkeypatch.setattr(db, "execute", lambda sql, *a, **k: ddl.append(sql))
    main._migrate()
    assert any("ADD COLUMN IF NOT EXISTS composition JSONB" in s and "tech_reports" in s
               for s in ddl), f"_migrate에 composition ALTER 누락: {[s for s in ddl if 'composition' in s]}"

    schema = pathlib.Path(main.__file__).parent.joinpath("app_schema.sql").read_text()
    block = schema.split("CREATE TABLE IF NOT EXISTS tech_reports (")[1].split(");")[0]
    assert "composition" in block, "app_schema.sql의 tech_reports 블록에 composition 컬럼 누락"
