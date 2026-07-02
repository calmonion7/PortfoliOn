"""S1: get_us_rankings wipe-on-empty guard."""
from unittest.mock import patch, MagicMock
import pytest

from services.ranking_service import get_us_rankings
from scheduler.jobs import _fetch_us_rankings


# ① empty quotes list → RuntimeError
def test_get_us_rankings_empty_quotes_raises():
    with patch("services.ranking_service.yf.screen", return_value={"quotes": []}):
        with pytest.raises(RuntimeError):
            get_us_rankings()


# ② non-dict response → RuntimeError
def test_get_us_rankings_non_dict_raises():
    with patch("services.ranking_service.yf.screen", return_value=None):
        with pytest.raises(RuntimeError):
            get_us_rankings()


# ③ scheduler swallows the error — replace_market_rankings never called
def test_fetch_us_rankings_does_not_replace_on_empty():
    with patch("services.ranking_service.yf.screen", return_value={"quotes": []}):
        with patch("services.ranking_service.replace_market_rankings") as mock_replace:
            _fetch_us_rankings()
            mock_replace.assert_not_called()
