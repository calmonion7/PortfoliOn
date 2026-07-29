import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch, MagicMock

from services.guru_scraper import (
    scrape_holdings,
    scrape_activity,
    _enrich_activity,
    _parse_activity,
    _parse_period,
)

_NUM_ROWS = 12


def _make_grid_html(num_rows: int) -> str:
    """table#grid fixture: 헤더 행 1개 + 데이터 행 num_rows개."""
    header = "<tr><td></td><td>Stock</td><td>% of portfolio</td></tr>"
    rows = [header]
    for i in range(1, num_rows + 1):
        rows.append(
            f"<tr><td>{i}</td><td>TCK{i}- Company {i}</td><td>{50 - i}.00%</td></tr>"
        )
    return f"<html><body><table id='grid'>{''.join(rows)}</table></body></html>"


def test_scrape_holdings_extracts_all_rows_and_top10_unchanged():
    html = _make_grid_html(_NUM_ROWS)
    mock_resp = MagicMock()
    mock_resp.text = html
    mock_resp.raise_for_status = MagicMock()

    with patch("services.guru_scraper.requests.get", return_value=mock_resp) as mock_get:
        result = scrape_holdings("m1")

    assert mock_get.call_count == 1  # soup 재사용, 추가 fetch 없음

    holdings = result["holdings"]
    top10 = result["top10"]

    assert len(holdings) == _NUM_ROWS
    assert len(top10) == 10
    assert result["num_stocks"] == _NUM_ROWS

    # holdings 항목엔 name_kr 없음
    assert "name_kr" not in holdings[0]
    # 3칸 fixture엔 Value 칸이 없다 — value 키도 없어야 한다(0 저장 금지, task#241)
    assert "value" not in holdings[0]

    for i in range(10):
        assert top10[i]["rank"] == i + 1
        assert top10[i]["ticker"] == f"TCK{i + 1}"
        assert top10[i]["name"] == f"Company {i + 1}"
        assert top10[i]["weight_pct"] == 50 - (i + 1)
        assert top10[i]["name_kr"] == ""
        # top10 항목이 holdings 앞 10개와 rank/ticker/weight_pct 동일
        assert top10[i]["rank"] == holdings[i]["rank"]
        assert top10[i]["ticker"] == holdings[i]["ticker"]
        assert top10[i]["weight_pct"] == holdings[i]["weight_pct"]


# ─────────────────────────────────────────────────────────────────────
# 분기 활동(task#239) — 직전 분기 대비 증감
# ─────────────────────────────────────────────────────────────────────

# 실제 holdings.php 행은 12칸이고 4번째(index 3)가 RecentActivity다.
# 위 fixture(3칸)와 공존해야 한다 — 3칸짜리는 activity 없이 graceful 통과해야 정상.
_REAL_ROWS = [
    ("AAA", "Alpha Inc.", "21.99", ""),               # 변동없음 → activity 키 부재
    ("BBB", "Beta Corp.", "9.52", "Reduce 0.71%"),
    ("CCC", "Gamma Ltd.", "5.93", "Add 203.99%"),
    ("DDD", "Delta Co.", "1.01", "Buy"),
]


def _make_real_grid_html() -> str:
    head = (
        "<tr><td></td><td>Stock</td><td>% ofPortfolio</td><td>RecentActivity</td>"
        "<td>Shares</td><td>ReportedPrice*</td><td>Value</td><td></td>"
        "<td>CurrentPrice</td><td>+/-ReportedPrice</td><td>52WeekLow</td><td>52WeekHigh</td></tr>"
    )
    rows = [head]
    for tk, nm, pct, act in _REAL_ROWS:
        rows.append(
            f"<tr><td>≡</td><td>{tk}- {nm}</td><td>{pct}</td><td>{act}</td>"
            f"<td>1,000</td><td>$10.00</td><td>$57,843,261,000</td><td></td>"
            f"<td>$11.00</td><td>10.00%</td><td>$9.00</td><td>$12.00</td></tr>"
        )
    p2 = (
        "<p id='p2'><span>Period:</span><span>Q1 2026</span>"
        "<span>Portfolio date:</span><span>31 Mar 2026</span>"
        "<span>No. of stocks:</span><span>4</span>"
        "<span>Portfolio value:</span><span>$2,310,986,000</span></p>"
    )
    return f"<html><body>{p2}<table id='grid'>{''.join(rows)}</table></body></html>"


def _resp(text):
    m = MagicMock()
    m.text = text
    m.raise_for_status = MagicMock()
    return m


def test_scrape_holdings_extracts_activity_and_period():
    with patch("services.guru_scraper.requests.get", return_value=_resp(_make_real_grid_html())):
        result = scrape_holdings("m1")

    assert result["period"] == "Q1 2026"
    assert result["portfolio_date"] == "2026-03-31"

    by_ticker = {h["ticker"]: h for h in result["holdings"]}
    # 변동없음은 activity 키 자체가 없어야 한다(빈 dict 아님)
    assert "activity" not in by_ticker["AAA"]
    assert by_ticker["BBB"]["activity"] == {"kind": "reduce", "share_pct": 0.71}
    assert by_ticker["CCC"]["activity"] == {"kind": "add", "share_pct": 203.99}
    # 신규매수는 직전 분기가 0이라 증감률이 없다
    assert by_ticker["DDD"]["activity"] == {"kind": "buy", "share_pct": None}
    # Value(cells[6]) = 신고 금액. 쉼표·$ 제거 후 정수(task#241)
    assert by_ticker["AAA"]["value"] == 57_843_261_000
    assert result["top10"][0]["value"] == 57_843_261_000


def test_parse_activity_patterns():
    assert _parse_activity("") is None
    assert _parse_activity("   ") is None
    assert _parse_activity("Buy") == {"kind": "buy", "share_pct": None}
    assert _parse_activity("Buy ") == {"kind": "buy", "share_pct": None}
    assert _parse_activity("Add 19.19%") == {"kind": "add", "share_pct": 19.19}
    assert _parse_activity("Reduce 0.48%") == {"kind": "reduce", "share_pct": 0.48}
    # Sell 은 라이브 전수 296건이 전부 100.00% = 전량매도
    assert _parse_activity("Sell 100.00%") == {"kind": "sold_out", "share_pct": 100.0}
    assert _parse_activity("Nonsense") is None


def test_parse_period_missing_is_none():
    assert _parse_period("No. of stocks: 4") == (None, None)
    # 월 이름은 locale 무관 명시 맵으로 해석한다
    assert _parse_period("Period: Q3 2025 Portfolio date: 30 Sep 2025") == ("Q3 2025", "2025-09-30")


# --- m_activity.php ---------------------------------------------------
# ⚠️ 이 fixture는 실제 페이지의 **깨진 마크업**을 그대로 재현한다: 데이터 행에 `<tr>`
#    시작 태그가 없고 닫는 `</tr>`만 있다. 그래서 `table.select("tr")`로 파싱하면
#    분기 헤더만 잡히고 데이터가 0행이 된다 — 이 fixture가 그 함정을 못박는다.

def _act_row(ticker, name, act_text, direction, shares, pct):
    return (
        f'<td class="hist"><a href="/m/hist/hist.php?f=X&s={ticker}">&#8801</a></td>\n'
        f'<td class="stock"><a href="/m/stock.php?sym={ticker}">{ticker}'
        f'<span> - {name}</span></a></td>\n'
        f'<td class="{direction}">{act_text}</td>\n'
        f'<td class="{direction}">{shares}</td>\n'
        f'<td>{pct}</td>\n</tr>'
    )


def _act_quarter(q, year):
    return f'<tr class="q_chg"><td colspan="5"><b>{q}</b> &nbsp<b>{year}</b></td></tr>'


def _make_activity_html(groups):
    """groups = [(q, year, [row html, ...]), ...] — 문서 순서대로 이어붙인다."""
    head = (
        '<thead><tr><td>History</td><td>Stock</td><td class="act">Activity</td>'
        '<td class="shares">Share change</td><td class="pct">% change to portfolio</td>'
        '</tr></thead>'
    )
    body = "".join(_act_quarter(q, y) + "".join(rows) for q, y, rows in groups)
    return f'<html><body><table id="grid">{head}<tbody>{body}</tbody></table></body></html>'


_Q1_ROWS = [
    _act_row("AMZN", "Amazon.com Inc.", "Add 19.19%", "buy", "1,844,157", "2.80"),
    _act_row("MSFT", "Microsoft Corp.", "Buy ", "buy", "5,654,078", "15.26"),
    _act_row("BBB", "Beta Corp.", "Reduce 0.71%", "sell", "12,708", "0.05"),
    _act_row("HLT", "Hilton Worldwide", "Sell 100.00%", "sell", "3,028,664", "5.60"),
]


def test_scrape_activity_parses_malformed_rows_and_stops_at_next_quarter():
    html = _make_activity_html([
        ("Q1", "2026", _Q1_ROWS),
        ("Q4", "2025", [_act_row("OLD", "Old Co.", "Add 5.00%", "buy", "100", "1.00")]),
    ])
    with patch("services.guru_scraper.requests.get", return_value=_resp(html)) as mock_get:
        out = scrape_activity("X")

    assert mock_get.call_count == 1          # 최신 분기가 완결됐으니 다음 페이지 요청 없음
    assert out["period"] == "Q1 2026"
    assert out["truncated"] is False
    # 최신 분기 4행만 — 더 오래된 분기(OLD)는 넘어오지 않는다
    assert [r["ticker"] for r in out["rows"]] == ["AMZN", "MSFT", "BBB", "HLT"]

    by = {r["ticker"]: r for r in out["rows"]}
    assert by["AMZN"]["kind"] == "add" and by["AMZN"]["share_pct"] == 19.19
    assert by["AMZN"]["port_pct"] == 2.80
    assert by["MSFT"]["kind"] == "buy" and by["MSFT"]["share_pct"] is None
    assert by["HLT"]["kind"] == "sold_out"
    assert by["HLT"]["port_pct"] == 5.60
    # 종목명은 <span>에서 오고 선행 '- '가 제거된다
    assert by["AMZN"]["name"] == "Amazon.com Inc."
    # 방향(교차검증용)은 td class에서 온다 — port_pct 자체는 무부호다
    assert by["BBB"]["direction"] == "sell" and by["BBB"]["port_pct"] == 0.05
    assert by["AMZN"]["direction"] == "buy"


def test_scrape_activity_follows_pagination_when_quarter_incomplete():
    """분기 헤더가 1개뿐 = 100행 절단 → 다음 L 페이지를 이어 받는다."""
    page1 = _make_activity_html([("Q1", "2026", _Q1_ROWS[:2])])
    page2 = _make_activity_html([
        ("Q1", "2026", _Q1_ROWS[2:]),
        ("Q4", "2025", [_act_row("OLD", "Old Co.", "Add 5.00%", "buy", "100", "1.00")]),
    ])
    with patch("services.guru_scraper.requests.get", side_effect=[_resp(page1), _resp(page2)]) as mock_get:
        with patch("services.guru_scraper.time.sleep"):
            out = scrape_activity("X")

    assert mock_get.call_count == 2
    assert "&L=2" in mock_get.call_args_list[1].args[0]
    assert [r["ticker"] for r in out["rows"]] == ["AMZN", "MSFT", "BBB", "HLT"]
    assert out["truncated"] is False


def test_scrape_activity_flags_truncation_at_page_cap():
    """상한까지 완결 안 되면 truncated=True — 무음 절단 금지."""
    page = _make_activity_html([("Q1", "2026", _Q1_ROWS[:1])])
    with patch("services.guru_scraper.requests.get", return_value=_resp(page)):
        with patch("services.guru_scraper.time.sleep"):
            out = scrape_activity("X")
    assert out["truncated"] is True


def test_enrich_activity_joins_port_pct_into_both_layers_and_returns_sold_out():
    details = {
        "period": "Q1 2026",
        "holdings": [
            {"rank": 1, "ticker": "AMZN", "name": "Amazon.com Inc.", "weight_pct": 17.4,
             "activity": {"kind": "add", "share_pct": 19.19}},
            {"rank": 2, "ticker": "AAA", "name": "Alpha Inc.", "weight_pct": 5.0},   # 변동없음
        ],
        "top10": [
            {"rank": 1, "ticker": "AMZN", "name": "Amazon.com Inc.", "name_kr": "아마존닷컴",
             "weight_pct": 17.4, "activity": {"kind": "add", "share_pct": 19.19}},
            {"rank": 2, "ticker": "AAA", "name": "Alpha Inc.", "name_kr": "", "weight_pct": 5.0},
        ],
    }
    html = _make_activity_html([("Q1", "2026", _Q1_ROWS), ("Q4", "2025", [])])
    with patch("services.guru_scraper.requests.get", return_value=_resp(html)):
        sold_out = _enrich_activity("X", details)

    assert details["holdings"][0]["activity"]["port_pct"] == 2.80
    assert details["top10"][0]["activity"]["port_pct"] == 2.80      # 두 계층 모두
    assert "activity" not in details["holdings"][1]                 # 변동없음은 그대로
    assert sold_out == [{"ticker": "HLT", "name": "Hilton Worldwide", "port_pct": 5.60}]


def _details_one_holding(period="Q1 2026"):
    return {
        "period": period,
        "holdings": [{"rank": 1, "ticker": "AMZN", "name": "Amazon.com Inc.", "weight_pct": 17.4,
                      "activity": {"kind": "add", "share_pct": 19.19}}],
        "top10": [{"rank": 1, "ticker": "AMZN", "name": "Amazon.com Inc.", "name_kr": "",
                   "weight_pct": 17.4, "activity": {"kind": "add", "share_pct": 19.19}}],
    }


def test_enrich_activity_keeps_holdings_activity_when_activity_page_fails():
    """B(활동 페이지)가 죽어도 A(holdings)의 kind/share_pct는 살아남아야 한다 — A가 정본."""
    details = _details_one_holding()
    with patch("services.guru_scraper.requests.get", side_effect=RuntimeError("418")):
        sold_out = _enrich_activity("X", details)

    assert sold_out == []
    assert details["holdings"][0]["activity"] == {"kind": "add", "share_pct": 19.19}
    assert "port_pct" not in details["holdings"][0]["activity"]


def test_enrich_activity_skips_stale_quarter():
    """활동 페이지 최신 분기가 보유 스냅샷보다 오래되면 보강을 통째 생략한다.

    라이브 실측(aq): 보유 Q2 2026 · 활동 Q4 2025 — 활동 페이지는 변동이 있던 분기만
    나열하므로 이 불일치가 실제로 발생한다. 그대로 조인하면 3분기 전 매도가
    '이번 분기 전량매도'로 뜬다(wrong > missing).
    """
    details = _details_one_holding(period="Q2 2026")
    html = _make_activity_html([("Q4", "2025", _Q1_ROWS), ("Q3", "2025", [])])
    with patch("services.guru_scraper.requests.get", return_value=_resp(html)):
        sold_out = _enrich_activity("aq", details)

    assert sold_out == []                                        # 오래된 매도가 새어나오지 않는다
    assert "port_pct" not in details["holdings"][0]["activity"]   # 비중 보강도 생략
    assert details["holdings"][0]["activity"]["kind"] == "add"    # A는 그대로


def test_enrich_activity_skips_when_period_unknown():
    """분기를 확인할 수 없으면(파싱 실패) 보강하지 않는다 — missing < wrong."""
    details = _details_one_holding(period=None)
    html = _make_activity_html([("Q1", "2026", _Q1_ROWS), ("Q4", "2025", [])])
    with patch("services.guru_scraper.requests.get", return_value=_resp(html)):
        assert _enrich_activity("X", details) == []
    assert "port_pct" not in details["holdings"][0]["activity"]
