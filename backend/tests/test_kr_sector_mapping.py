"""보유 KR 종목 → KRX 업종 매핑 (task 48, S3).

ka10001엔 업종 필드가 없음(라이브 프로브 확인) → ka20002(업종별주가) 역인덱스로 매핑.
업종 미상 시 graceful(누락만, 예외 금지).
"""
import services.kr_sector_service as svc


def test_build_sector_index_reverse_maps_stocks(monkeypatch):
    # 업종별 종목 리스트 → {종목코드: 업종명} 역인덱스
    table = {
        "013": ["005930", "000660"],   # 전기/전자: 삼성전자·SK하이닉스
        "008": ["051910"],             # 화학: LG화학
    }
    monkeypatch.setattr(svc.kw_sector, "KOSPI_SECTORS",
                        [{"code": "013", "name": "전기/전자"}, {"code": "008", "name": "화학"}])
    monkeypatch.setattr(svc.kw_sector, "fetch_sector_stocks", lambda code: table.get(code, []))

    idx = svc.build_sector_index()
    assert idx["005930"] == "전기/전자"
    assert idx["000660"] == "전기/전자"
    assert idx["051910"] == "화학"


def test_map_holdings_to_sectors_hits_and_misses(monkeypatch):
    # task 50 S2: 요청 경로는 저장 인덱스(load_sector_index)만 읽는다 — 라이브 build 호출 금지
    idx = {"005930": "전기/전자", "051910": "화학"}
    monkeypatch.setattr(svc, "load_sector_index", lambda: idx)

    holdings = [
        {"ticker": "005930", "market": "KR"},
        {"ticker": "051910", "market": "KR"},
        {"ticker": "999999", "market": "KR"},   # 업종 미상
        {"ticker": "AAPL", "market": "US"},      # 비-KR은 무시
    ]
    out = svc.map_holdings_to_sectors(holdings)
    assert out["005930"] == "전기/전자"
    assert out["051910"] == "화학"
    # 업종 미상은 graceful — 키 누락(예외 아님)
    assert "999999" not in out
    assert "AAPL" not in out


def test_map_holdings_uses_stored_index_no_live_kiwoom(monkeypatch):
    """task 50 S2: 요청 시 build_sector_index(ka20002 라이브)를 호출하지 않는다."""
    monkeypatch.setattr(svc, "load_sector_index", lambda: {"005930": "전기/전자"})

    def _fail():
        raise AssertionError("build_sector_index must not be called on request path")
    monkeypatch.setattr(svc, "build_sector_index", _fail)
    # ka20002 직접 호출도 막아 이중 방어
    monkeypatch.setattr(svc.kw_sector, "fetch_sector_stocks",
                        lambda code: (_ for _ in ()).throw(AssertionError("ka20002 must not be called")))

    out = svc.map_holdings_to_sectors([{"ticker": "005930", "market": "KR"}])
    assert out == {"005930": "전기/전자"}


def test_map_holdings_empty_when_stored_index_empty(monkeypatch):
    """저장 인덱스가 비면(첫 배치 전) graceful 빈 매핑 — 라이브로 메우지 않는다."""
    monkeypatch.setattr(svc, "load_sector_index", lambda: {})
    monkeypatch.setattr(svc, "build_sector_index",
                        lambda: (_ for _ in ()).throw(AssertionError("must not call build")))
    out = svc.map_holdings_to_sectors([{"ticker": "005930", "market": "KR"}])
    assert out == {}


def test_build_sector_index_swallows_per_sector_errors(monkeypatch):
    def flaky(code):
        if code == "008":
            raise RuntimeError("kiwoom timeout")
        return ["005930"]

    monkeypatch.setattr(svc.kw_sector, "KOSPI_SECTORS",
                        [{"code": "013", "name": "전기/전자"}, {"code": "008", "name": "화학"}])
    monkeypatch.setattr(svc.kw_sector, "fetch_sector_stocks", flaky)
    # 한 업종 fetch 실패해도 나머지는 매핑(예외 전파 금지)
    idx = svc.build_sector_index()
    assert idx["005930"] == "전기/전자"


def test_map_holdings_empty_when_no_kr(monkeypatch):
    monkeypatch.setattr(svc, "build_sector_index", lambda: {})
    out = svc.map_holdings_to_sectors([{"ticker": "AAPL", "market": "US"}])
    assert out == {}
