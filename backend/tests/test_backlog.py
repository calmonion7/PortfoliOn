import io
import json
import sys
import zipfile
from pathlib import Path

import pytest
sys.path.insert(0, str(Path(__file__).parent.parent))


# ── _get_document_text (document.xml ZIP → 전 멤버 디코드 결합) ──

class _FakeResp:
    def __init__(self, content, status_code=200):
        self.content = content
        self.status_code = status_code


def _make_zip(members: dict[str, str]) -> bytes:
    """members: {filename: text} → in-memory ZIP bytes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, text in members.items():
            zf.writestr(name, text.encode("utf-8"))
    return buf.getvalue()


def test_get_document_text_scans_all_members(monkeypatch):
    from services import backlog as svc

    target = "회사의 건설계약 수주잔고는 69,402,839백만원"
    # target은 두 번째(서브문서) 멤버에 둔다 → 전 멤버 스캔 확인
    zip_bytes = _make_zip({
        "00000000_main.xml": "<TABLE><TR><TD>메인 문서</TD></TR></TABLE>",
        "00000001_sub.xml": f"<P>2025년 12월 31일 현재, {target}(전기말: 60,316,685백만원)입니다.</P>",
    })

    monkeypatch.setattr(
        svc.requests, "get",
        lambda *a, **k: _FakeResp(zip_bytes),
    )

    text = svc._get_document_text("20260101000001")
    assert target in text
    assert "메인 문서" in text


def test_get_document_text_non_zip_returns_empty(monkeypatch):
    from services import backlog as svc

    monkeypatch.setattr(
        svc.requests, "get",
        lambda *a, **k: _FakeResp(b'{"status":"101"}'),
    )

    assert svc._get_document_text("X") == ""


# ── _extract_backlog_blocks ("수주" 블록 추출 + 단위 감지) ──

def test_extract_backlog_blocks_hyundai_form():
    from services import backlog as svc

    html = (
        "<TABLE><TR><TD>구분</TD><TD>금액</TD></TR></TABLE>"
        "<P>2025년 12월 31일 현재, 회사의 건설계약 수주잔고는 "
        "69,402,839백만원(전기말: 60,316,685백만원)입니다.</P>"
    )
    raw_text, unit = svc._extract_backlog_blocks(html)
    assert "수주잔고는 69,402,839백만원" in raw_text
    assert unit == "백만원"


def test_extract_backlog_blocks_no_keyword_returns_empty():
    from services import backlog as svc

    html = "<p>일반 내용으로 관련 정보가 없습니다.</p>"
    raw_text, unit = svc._extract_backlog_blocks(html)
    assert raw_text == ""


def test_extract_backlog_blocks_caps_length():
    from services import backlog as svc

    # 수주 블록을 매우 많이 만들어 8000자 캡 확인
    blocks = "".join(
        f"<p>{i}번 수주잔고는 {i},000백만원입니다 추가내용 패딩 텍스트.</p>"
        for i in range(2000)
    )
    raw_text, _ = svc._extract_backlog_blocks(blocks)
    assert len(raw_text) <= 8000


def test_extract_backlog_blocks_excludes_noise():
    from services import backlog as svc

    # 수주잔고(정탐) 블록 + 수주추진비(급여표)·수주산업전문가(감사표) 노이즈
    html = (
        "<P>2025년 12월 31일 현재, 회사의 건설계약 수주잔고는 "
        "69,402,839백만원(전기말: 60,316,685백만원)입니다.</P>"
        "<TABLE><TR><TD>수주추진비 등</TD><TD>118,558</TD></TR></TABLE>"
        "<TABLE><TR><TD>건설계약 등수주산업전문가</TD><TD>12</TD></TR></TABLE>"
    )
    raw_text, unit = svc._extract_backlog_blocks(html)
    assert "수주잔고는 69,402,839백만원" in raw_text
    assert "수주추진비" not in raw_text
    assert "수주산업전문가" not in raw_text
    assert unit == "백만원"


def test_extract_backlog_blocks_recognizes_keyword_variants():
    from services import backlog as svc

    for kw in ("수주총액", "수주잔량", "수주잔액"):
        html = f"<p>당기말 {kw}은 1,234억원입니다.</p>"
        raw_text, unit = svc._extract_backlog_blocks(html)
        assert kw in raw_text
        assert unit == "억원"


def test_extract_backlog_blocks_bare_susu_excluded():
    from services import backlog as svc

    # 정탐 키워드 없이 "수주"만(수주계약/수주산업/수주현황) → 추출 안 함
    html = "<p>수주계약 현황 및 수주산업 관련 일반 서술입니다.</p>"
    raw_text, _ = svc._extract_backlog_blocks(html)
    assert raw_text == ""


# ── _quarter_from_report (괄호 (YYYY.MM) 우선, 명칭 휴리스틱 폴백) ──

def test_quarter_from_report_bracket_parsing():
    from services import backlog as svc

    assert svc._quarter_from_report("분기보고서 (2026.03)", "20260515") == "2026Q1"
    assert svc._quarter_from_report("반기보고서 (2025.06)", "20250814") == "2025Q2"
    assert svc._quarter_from_report("분기보고서 (2025.09)", "20251114") == "2025Q3"
    # 접수연도(2026)가 아니라 괄호값(2025)을 사용해야 함
    assert svc._quarter_from_report("사업보고서 (2025.12)", "20260318") == "2025Q4"
    assert svc._quarter_from_report("[기재정정]사업보고서 (2024.12)", "20251017") == "2024Q4"


# ── fetch_all_backlog (DB query + per-ticker fetch faked) ──

def test_fetch_all_backlog_query_filters_kr(monkeypatch):
    from services import backlog as svc
    captured = {}

    def fake_query(sql, params=None):
        captured["sql"] = sql
        return [{"ticker": "005930.KS"}]

    monkeypatch.setattr(svc, "query", fake_query)
    monkeypatch.setattr(svc, "fetch_and_save_backlog", lambda t: [])
    svc.fetch_all_backlog()

    assert "market = 'KR'" in captured["sql"]
    assert "user_stocks" in captured["sql"]
    assert "tickers" in captured["sql"]


def test_fetch_all_backlog_calls_each_ticker(monkeypatch):
    from services import backlog as svc
    calls = []

    monkeypatch.setattr(
        svc, "query",
        lambda sql, params=None: [{"ticker": "005930.KS"}, {"ticker": "000660.KS"}],
    )
    monkeypatch.setattr(svc, "fetch_and_save_backlog", lambda t: calls.append(t))

    result = svc.fetch_all_backlog()

    assert calls == ["005930.KS", "000660.KS"]
    assert result == {"total": 2, "ok": 2, "failed": 0}


def test_fetch_all_backlog_continues_on_error(monkeypatch):
    from services import backlog as svc
    calls = []

    def flaky(t):
        calls.append(t)
        if t == "005930.KS":
            raise RuntimeError("boom")

    monkeypatch.setattr(
        svc, "query",
        lambda sql, params=None: [{"ticker": "005930.KS"}, {"ticker": "000660.KS"}],
    )
    monkeypatch.setattr(svc, "fetch_and_save_backlog", flaky)

    result = svc.fetch_all_backlog()

    assert calls == ["005930.KS", "000660.KS"]
    assert result == {"total": 2, "ok": 1, "failed": 1}


# ── fetch_and_save_backlog (document.xml + Cowork pending 통합) ──

def test_fetch_and_save_backlog_saves_pending_and_skips_no_keyword(monkeypatch):
    from services import backlog as svc

    upserts = []

    monkeypatch.setattr(svc, "_get_corp_code", lambda t: "00164478")
    monkeypatch.setattr(
        svc, "_get_recent_reports",
        lambda corp_code: [
            {"rcept_no": "111", "report_nm": "사업보고서 (2025.12)", "rcept_dt": "20260318"},
            {"rcept_no": "222", "report_nm": "분기보고서 (2025.09)", "rcept_dt": "20251114"},
        ],
    )

    def fake_document_text(rcept_no):
        if rcept_no == "111":
            return (
                "<P>2025년 12월 31일 현재, 회사의 건설계약 수주잔고는 "
                "69,402,839백만원(전기말: 60,316,685백만원)입니다.</P>"
            )
        return "<P>해당 사항 없음.</P>"

    pendings = []
    monkeypatch.setattr(svc, "_get_document_text", fake_document_text)
    monkeypatch.setattr(svc, "_upsert", lambda ticker, entries: upserts.append((ticker, entries)))
    monkeypatch.setattr(svc, "_save_pending",
                        lambda ticker, quarter, unit, raw_text: pendings.append((ticker, quarter, unit, raw_text)))
    monkeypatch.setattr(svc, "get_backlog", lambda ticker: [{"quarter": "2025Q4"}])
    monkeypatch.setattr(svc, "get_financials", lambda *a, **k: {})
    monkeypatch.setattr(svc.time, "sleep", lambda s: None)

    result = svc.fetch_and_save_backlog("000720.KS")

    # 추출 실패(단일/다중 자동추출 모두 None) → _save_pending으로 저장(_upsert 아님), 수주 없는 보고서는 skip
    assert upserts == []
    assert len(pendings) == 1
    ticker, quarter, unit, raw_text = pendings[0]
    assert ticker == "000720.KS"
    assert quarter == "2025Q4"
    assert "수주잔고는 69,402,839백만원" in raw_text
    assert unit == "백만원"
    # 반환값은 get_backlog 결과
    assert result == [{"quarter": "2025Q4"}]


def test_fetch_and_save_backlog_no_corp_code_returns_backlog(monkeypatch):
    from services import backlog as svc

    monkeypatch.setattr(svc, "_get_corp_code", lambda t: None)
    monkeypatch.setattr(svc, "get_backlog", lambda ticker: [])

    assert svc.fetch_and_save_backlog("ZZZ") == []


# ── 재무제표 컨텍스트 (Cowork pending 분석용) ──

class _FakeJsonResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def test_won_to_eok_normalizes_won_to_eok():
    from services import backlog as svc

    # 2,670,290,124,900원 = 26,702.9...억원
    assert abs(svc._won_to_eok("2,670,290,124,900") - 26702.901249) < 1e-2
    assert abs(svc._won_to_eok("(1,000,000,000)") - (-10.0)) < 1e-9
    assert svc._won_to_eok("-") is None
    assert svc._won_to_eok("xyz") is None


def test_get_financials_prefers_cfs_and_normalizes(monkeypatch):
    from services import backlog as svc

    payload = {
        "status": "000",
        "list": [
            {"fs_div": "CFS", "account_nm": "매출액",
             "thstrm_amount": "2,670,290,124,900", "frmtrm_amount": "1,124,012,148,400"},
            {"fs_div": "OFS", "account_nm": "매출액",  # 별도는 연결이 있으면 무시
             "thstrm_amount": "999", "frmtrm_amount": "999"},
            {"fs_div": "CFS", "account_nm": "자산총계",
             "thstrm_amount": "5,395,366,960,400", "frmtrm_amount": "4,356,193,404,300"},
        ],
    }
    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _FakeJsonResp(payload))

    fin = svc.get_financials("00164478", "2025Q4")
    assert fin["_fs"] == "연결"
    assert abs(fin["매출액"]["당기"] - 26702.901249) < 1e-2
    assert "자산총계" in fin


def test_get_financials_bad_status_returns_empty(monkeypatch):
    from services import backlog as svc

    monkeypatch.setattr(svc.requests, "get", lambda *a, **k: _FakeJsonResp({"status": "013"}))
    assert svc.get_financials("X", "2025Q4") == {}


def test_save_llm_backlog_with_segments(monkeypatch):
    from services import backlog as svc
    calls = []
    monkeypatch.setattr(svc, "execute", lambda sql, params: calls.append((sql, params)))
    segs = [{"sector": "항공", "entity": "한화에어로", "amount": 323995.45},
            {"sector": "해양", "entity": "한화오션", "amount": 344950.64}]
    svc.save_llm_backlog("012450", [{"quarter": "2025Q4", "amount": 1168007.29, "segments": segs}])
    assert len(calls) == 1
    sql, params = calls[0]
    assert "COALESCE" in sql and "segments" in sql
    assert "IN ('pending', 'llm')" in sql  # 자신이 채운 llm 행도 재-PUT 가능
    assert params[0] == 1168007.29
    assert json.loads(params[1]) == segs
    assert params[2] == "012450" and params[3] == "2025Q4"


def test_save_llm_backlog_without_segments_passes_null(monkeypatch):
    from services import backlog as svc
    calls = []
    monkeypatch.setattr(svc, "execute", lambda sql, params: calls.append((sql, params)))
    svc.save_llm_backlog("005380", [{"quarter": "2024Q3", "amount": 90312.0}])
    _, params = calls[0]
    assert params[1] is None  # segments 미제공 → COALESCE로 기존값 유지


def test_get_backlog_selects_and_returns_segments(monkeypatch):
    from services import backlog as svc
    cap = {}

    def fake_query(sql, params):
        cap["sql"] = sql
        return [{"quarter": "2025Q4", "amount": 1168007.29, "unit": "억원", "source": "llm",
                 "segments": [{"sector": "항공", "entity": "한화에어로", "amount": 323995.45}]}]

    monkeypatch.setattr(svc, "query", fake_query)
    rows = svc.get_backlog("012450")
    assert "segments" in cap["sql"]
    assert rows[0]["segments"][0]["sector"] == "항공"


def test_fetch_and_save_prepends_financials_context(monkeypatch):
    from services import backlog as svc

    pendings = []
    monkeypatch.setattr(svc, "_get_corp_code", lambda t: "00164478")
    monkeypatch.setattr(svc, "_get_recent_reports", lambda corp_code: [
        {"rcept_no": "111", "report_nm": "사업보고서 (2025.12)", "rcept_dt": "20260318"},
    ])
    monkeypatch.setattr(svc, "_get_document_text", lambda r: (
        "<P>2025년 12월 31일 현재, 회사의 건설계약 수주잔고는 69,402,839백만원입니다.</P>"
    ))
    monkeypatch.setattr(svc, "_save_pending",
                        lambda ticker, quarter, unit, raw_text: pendings.append((ticker, quarter, unit, raw_text)))
    monkeypatch.setattr(svc, "get_backlog", lambda ticker: [])
    monkeypatch.setattr(svc, "get_financials", lambda corp, q: {
        "_fs": "연결", "매출액": {"당기": 26702.9, "전기": 11240.1},
    })
    monkeypatch.setattr(svc.time, "sleep", lambda s: None)

    svc.fetch_and_save_backlog("000720.KS")

    assert len(pendings) == 1
    raw = pendings[0][3]
    assert "[재무 컨텍스트]" in raw
    assert "매출액: 당기=26702.9" in raw
    # 수주 원문은 컨텍스트 뒤에 그대로 보존
    assert "수주잔고는 69,402,839백만원" in raw
    assert raw.index("[재무 컨텍스트]") < raw.index("수주잔고는")


# ── pending 값 보존 가드 + 다중엔티티 자동 segments (task 15) ──

def test_save_pending_preserves_existing_amount(monkeypatch):
    from services import backlog as svc
    calls = []
    monkeypatch.setattr(svc, "execute", lambda sql, params: calls.append((sql, params)))
    svc._save_pending("012450", "2025Q4", "백만원", "raw")
    sql, params = calls[0]
    # 이미 채워진(amount not null) 행은 pending으로 덮지 않음: SET 절에 amount 대입 없음
    set_part = sql.split("DO UPDATE SET", 1)[1]
    assert "amount =" not in set_part and "amount=" not in set_part.replace(" ", "")
    # 미채움일 때만 pending: amount IS NULL 가드 존재
    assert "amount IS NULL" in sql
    assert params[0] == "012450" and params[1] == "2025Q4"


def test_fetch_and_save_multi_entity_auto_segments(monkeypatch):
    from services import backlog as svc
    han = (Path(__file__).parent / "fixtures" / "backlog" / "012450.html").read_text().split("-->", 1)[1]
    doc = f"<p>(단위 : 백만원)</p>{han}"
    ups = []
    monkeypatch.setattr(svc, "_get_corp_code", lambda t: "X")
    monkeypatch.setattr(svc, "_get_recent_reports",
                        lambda c: [{"rcept_no": "1", "report_nm": "사업보고서 (2025.12)", "rcept_dt": "20260318"}])
    monkeypatch.setattr(svc, "_get_document_text", lambda r: doc)
    monkeypatch.setattr(svc, "_upsert", lambda tk, entries: ups.append((tk, entries)))
    monkeypatch.setattr(svc, "_save_pending", lambda *a: ups.append(("PENDING", a)))
    monkeypatch.setattr(svc, "get_backlog", lambda t: [])
    monkeypatch.setattr(svc.time, "sleep", lambda s: None)

    svc.fetch_and_save_backlog("012450")
    assert len(ups) == 1 and ups[0][0] == "012450", "다중엔티티는 dart로 저장(pending 아님)"
    e = ups[0][1][0]
    assert e["source"] == "dart"
    assert abs(e["amount"] - 1168007.29) < 1
    assert e["segments"] and abs(sum(s["amount"] for s in e["segments"]) - e["amount"]) < 1
