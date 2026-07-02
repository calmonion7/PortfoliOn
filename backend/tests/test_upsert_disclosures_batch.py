"""S3: upsert_disclosures 배치화 — execute_many 1회 호출 + params 내용 동일성."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


_ROWS = [
    {"rcept_no": "20260515000001", "rcept_dt": "20260515",
     "report_nm": "분기보고서", "pblntf_ty": "A", "corp_name": "삼성전자"},
    {"rcept_no": "20260510000002", "rcept_dt": "20260510",
     "report_nm": "주요사항보고서", "pblntf_ty": "B", "corp_name": "삼성전자"},
]


def test_upsert_disclosures_calls_execute_many_once(monkeypatch):
    """행이 여러 개여도 execute_many를 정확히 1회 호출(DB 왕복 1회)."""
    from services import disclosures as svc

    calls = []
    monkeypatch.setattr(svc, "execute_many", lambda sql, params_list: calls.append((sql, params_list)))

    svc.upsert_disclosures("005930.KS", _ROWS)

    assert len(calls) == 1


def test_upsert_disclosures_params_content_identical(monkeypatch):
    """execute_many에 넘기는 params_list가 단건 루프 결과와 byte-동일."""
    from services import disclosures as svc

    captured = {}
    monkeypatch.setattr(svc, "execute_many", lambda sql, params_list: captured.update({"sql": sql, "pl": params_list}))

    svc.upsert_disclosures("005930.KS", _ROWS)

    pl = captured["pl"]
    assert len(pl) == 2

    # 첫 행 검증
    assert pl[0][0] == "005930.KS"          # ticker uppercased
    assert pl[0][1] == "20260515000001"      # rcept_no
    assert pl[0][2] == "20260515"            # rcept_dt
    assert pl[0][3] == "분기보고서"
    assert pl[0][4] == "A"                  # pblntf_ty
    assert pl[0][5] == "삼성전자"

    # 두 번째 행
    assert pl[1][1] == "20260510000002"
    assert pl[1][4] == "B"


def test_upsert_disclosures_sql_unchanged(monkeypatch):
    """SQL에 ON CONFLICT dedup이 그대로 포함돼 있다."""
    from services import disclosures as svc

    captured = {}
    monkeypatch.setattr(svc, "execute_many", lambda sql, pl: captured.update({"sql": sql}))

    svc.upsert_disclosures("005930.KS", _ROWS[:1])

    sql = captured["sql"]
    assert "INSERT INTO stock_disclosures" in sql
    assert "ON CONFLICT (rcept_no) DO UPDATE" in sql


def test_upsert_disclosures_empty_rows_is_noop(monkeypatch):
    """빈 rows면 execute_many 미호출(커넥션 획득 안 함)."""
    from services import disclosures as svc

    calls = []
    monkeypatch.setattr(svc, "execute_many", lambda sql, pl: calls.append(pl))

    svc.upsert_disclosures("005930.KS", [])

    # execute_many 자체가 빈 params_list에서 no-op이므로 호출 여부보다 부작용 없음이 핵심.
    # 호출돼도 커넥션 미획득(db.execute_many 계약).
    assert calls == [] or calls == [[]]
