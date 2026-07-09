"""키움 업종 series 모듈 단위테스트 (task 48, S1).

라이브 ka20006(업종일봉)·ka10101(업종코드) 응답을 fixture로 고정.
종가 series 정규화(부호 절대값·날짜 오름차순)·큐레이션 목록을 단언한다.
"""
from services.kiwoom import sector


# ── ka20006 업종일봉 라이브 응답 형태(2026-06 프로브로 확인) ──
# LIST 키 inds_dt_pole_qry, 필드 dt/cur_prc/open_pric/high_pric/low_pric/trde_qty.
# 키움은 최신→과거 순으로 내려준다(역순).
def _rows():
    return [
        {"dt": "20260612", "cur_prc": "477841", "open_pric": "481775",
         "high_pric": "486910", "low_pric": "474124", "trde_qty": "37351"},
        {"dt": "20260611", "cur_prc": "480100", "open_pric": "479000",
         "high_pric": "482000", "low_pric": "478000", "trde_qty": "40000"},
        {"dt": "20260610", "cur_prc": "475000", "open_pric": "474000",
         "high_pric": "476000", "low_pric": "473000", "trde_qty": "35000"},
    ]


def test_normalize_closes_sorts_ascending():
    closes = sector.normalize_closes(_rows())
    # 오름차순(과거→현재), 최신이 마지막
    assert closes == [475000.0, 480100.0, 477841.0]


def test_normalize_closes_abs_on_signed():
    rows = [{"dt": "20260101", "cur_prc": "-152000"},
            {"dt": "20260102", "cur_prc": "+153000"}]
    assert sector.normalize_closes(rows) == [152000.0, 153000.0]


def test_normalize_closes_drops_rows_without_date_or_close():
    rows = [{"dt": "", "cur_prc": "100"}, {"dt": "20260101", "cur_prc": ""},
            {"dt": "20260102", "cur_prc": "200"}]
    assert sector.normalize_closes(rows) == [200.0]


def test_fetch_sector_closes_uses_ka20006(monkeypatch):
    captured = {}

    def fake_request_paged(api_id, body, category, list_key, max_items=1000):
        captured["api_id"] = api_id
        captured["category"] = category
        captured["list_key"] = list_key
        captured["body"] = body
        return _rows()

    monkeypatch.setattr(sector.client, "request_paged", fake_request_paged)
    closes = sector.fetch_sector_closes("008", base_dt="20260613", max_items=100)
    assert captured["api_id"] == "ka20006"
    assert captured["category"] == "chart"
    assert captured["list_key"] == "inds_dt_pole_qry"
    assert captured["body"]["inds_cd"] == "008"
    assert closes == [475000.0, 480100.0, 477841.0]


def test_fetch_sector_closes_truncates_to_recent(monkeypatch):
    rows = [{"dt": f"202601{str(i).zfill(2)}", "cur_prc": str(100 + i)} for i in range(1, 40)]
    monkeypatch.setattr(sector.client, "request_paged", lambda *a, **k: rows)
    closes = sector.fetch_sector_closes("008", base_dt="20260201", max_items=10)
    assert len(closes) == 10
    # 오름차순 최근 10개 → 마지막이 가장 큰 날짜(202601 39 = +139)
    assert closes[-1] == 139.0
    assert closes[0] == 130.0


# ── task 50 S3: base_dt 인트라데이 견고화 ──────────────────────────────────────
def test_last_completed_trading_day_skips_weekend():
    import datetime as _dt
    # 토요일 2026-06-13 → 직전 거래일 금요일 2026-06-12
    assert sector._last_completed_trading_day(_dt.date(2026, 6, 13)) == "20260612"
    # 일요일 2026-06-14 → 금요일 2026-06-12
    assert sector._last_completed_trading_day(_dt.date(2026, 6, 14)) == "20260612"
    # 평일(화 2026-06-16) → 그날(거래중 인트라데이도 종가 history는 직전 종가까지 옴)
    assert sector._last_completed_trading_day(_dt.date(2026, 6, 16)) == "20260616"
    # 월요일 2026-06-15 → 그날
    assert sector._last_completed_trading_day(_dt.date(2026, 6, 15)) == "20260615"


def test_fetch_sector_closes_default_base_dt_is_trading_day(monkeypatch):
    """base_dt 미지정 시 마지막 완성 거래일을 base_dt로 보낸다(주말 인트라데이 빈값 방지)."""
    import datetime as _dt

    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 14))  # 일요일
    captured = {}

    def fake_paged(api_id, body, *a, **k):
        captured["base_dt"] = body["base_dt"]
        return _rows()

    monkeypatch.setattr(sector.client, "request_paged", fake_paged)
    sector.fetch_sector_closes("008")
    assert captured["base_dt"] == "20260612"  # 금요일로 정규화


def test_fetch_sector_closes_falls_back_when_empty(monkeypatch):
    """오늘 base_dt가 빈 series면 직전 거래일로 1회 폴백해 종가를 채운다."""
    import datetime as _dt

    monkeypatch.setattr(sector, "today_kst", lambda: _dt.date(2026, 6, 16))  # 화요일(거래중)
    calls = []

    def fake_paged(api_id, body, *a, **k):
        calls.append(body["base_dt"])
        # 첫 콜(오늘 20260616)은 빈값, 폴백 콜(직전 거래일)은 데이터
        return [] if body["base_dt"] == "20260616" else _rows()

    monkeypatch.setattr(sector.client, "request_paged", fake_paged)
    closes = sector.fetch_sector_closes("008")
    assert closes == [475000.0, 480100.0, 477841.0]
    assert calls[0] == "20260616"
    assert calls[1] == "20260615"  # 직전 거래일(월)로 폴백


def test_fetch_sector_closes_explicit_base_dt_no_fallback(monkeypatch):
    """base_dt 명시 시 폴백 없이 그 날짜 1콜만(기존 동작 보존)."""
    calls = []

    def fake_paged(api_id, body, *a, **k):
        calls.append(body["base_dt"])
        return []

    monkeypatch.setattr(sector.client, "request_paged", fake_paged)
    closes = sector.fetch_sector_closes("008", base_dt="20260613")
    assert closes == []
    assert calls == ["20260613"]  # 폴백 안 함


def test_kospi_sectors_curated():
    sectors = sector.KOSPI_SECTORS
    codes = {s["code"] for s in sectors}
    names = {s["name"] for s in sectors}
    # 큐레이션: 실제 업종(005~030)만, 규모지수(종합/대형/중형/소형)·특수지수 제외
    assert "013" in codes and "전기/전자" in names   # 대표 업종
    assert "008" in codes and "화학" in names
    assert "021" in codes and "금융" in names
    assert "001" not in codes   # 종합(KOSPI) 제외
    assert "002" not in codes   # 대형주 제외
    assert "603" not in codes   # 변동성지수 제외
    # 코드·이름이 모두 채워짐
    for s in sectors:
        assert s["code"] and s["name"]
