import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch, MagicMock

from services.guru_scraper import scrape_holdings

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
