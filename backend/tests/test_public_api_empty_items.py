"""S3 — 공공데이터포털 빈응답 AttributeError 가드 (bug-report #24·#25)"""
from unittest.mock import patch, MagicMock


def _make_response(body: dict) -> MagicMock:
    m = MagicMock()
    m.ok = True
    m.json.return_value = {"response": {"body": body}}
    return m


# ── lending_service._api_get ──────────────────────────────────────────────────

class TestLendingApiGet:
    def _call(self, body):
        from services import lending_service
        with patch("services.lending_service.requests.get", return_value=_make_response(body)):
            return lending_service._api_get()

    def test_empty_items_string_returns_empty_list(self):
        # 공공데이터포털 무결과: {"items": ""}
        result = self._call({"items": ""})
        assert result == []

    def test_normal_items_list(self):
        item = {"basDt": "20240101", "foo": "bar"}
        result = self._call({"items": {"item": [item]}})
        assert result == [item]

    def test_normal_items_single_dict(self):
        # API가 단건일 때 list가 아닌 dict를 반환하는 경우
        item = {"basDt": "20240101"}
        result = self._call({"items": {"item": item}})
        assert result == [item]


# ── leverage_service._kofia_get ───────────────────────────────────────────────

class TestKofiaGet:
    def _call(self, body):
        from services import leverage_service
        with patch("services.leverage_service.requests.get", return_value=_make_response(body)):
            return leverage_service._kofia_get("http://fake/endpoint")

    def test_empty_items_string_returns_empty_list(self):
        # 공공데이터포털 무결과: {"items": "", "totalCount": 0, ...}
        result = self._call({"items": "", "totalCount": 0, "pageNo": 1, "numOfRows": 1000})
        assert result == []

    def test_normal_items_list(self):
        item = {"basDt": "20240101", "val": "1"}
        result = self._call({"items": {"item": [item]}, "totalCount": 1, "pageNo": 1, "numOfRows": 1000})
        assert result == [item]

    def test_normal_items_single_dict(self):
        item = {"basDt": "20240101"}
        result = self._call({"items": {"item": item}, "totalCount": 1, "pageNo": 1, "numOfRows": 1000})
        assert result == [item]
