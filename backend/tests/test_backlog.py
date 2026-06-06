import io
import sys
import zipfile
from pathlib import Path
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

    monkeypatch.setattr(svc, "_get_document_text", fake_document_text)
    monkeypatch.setattr(svc, "_upsert", lambda ticker, entries: upserts.append((ticker, entries)))
    monkeypatch.setattr(svc, "get_backlog", lambda ticker: [{"quarter": "2025Q4"}])
    monkeypatch.setattr(svc.time, "sleep", lambda s: None)

    result = svc.fetch_and_save_backlog("000720.KS")

    # 수주 있는 보고서(2025Q4)만 pending으로 저장, 수주 없는 보고서(2025Q3)는 skip
    assert len(upserts) == 1
    ticker, entries = upserts[0]
    assert ticker == "000720.KS"
    assert len(entries) == 1
    e = entries[0]
    assert e["quarter"] == "2025Q4"
    assert e["source"] == "pending"
    assert e.get("amount") is None
    assert "수주잔고는 69,402,839백만원" in e["raw_text"]
    assert e["unit"] == "백만원"
    # 반환값은 get_backlog 결과
    assert result == [{"quarter": "2025Q4"}]


def test_fetch_and_save_backlog_no_corp_code_returns_backlog(monkeypatch):
    from services import backlog as svc

    monkeypatch.setattr(svc, "_get_corp_code", lambda t: None)
    monkeypatch.setattr(svc, "get_backlog", lambda ticker: [])

    assert svc.fetch_and_save_backlog("ZZZ") == []
