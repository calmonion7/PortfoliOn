"""B43: US 섹터 모멘텀 부분 페이로드 백필 (`services/us_sector_service.refresh`).

ETF 11종은 서로 합산되지 않는 **독립 항목**이라 완전성 요구도 커버리지 임계도 아니다 —
실패한 심볼만 직전값으로 백필하고 성공분은 갱신한다(task#261 그릴링 합의: "합산·비중
계열은 생략, 독립 수치 계열은 백필"). 형제 `kr_sector_service.refresh`의 per-항목 백필을
미러하되 매칭 키가 다르다 — KR은 `code`, US sectors dict엔 `code`가 없으니 **`etf`**.

옛 구현은 all-None만 막아 "좋은 1개 + all-None 10개"가 직전 양호값을 덮었다.

red 조건: 저장 함수 mock의 call_args로 *실제로 저장된 페이로드*를 본다(회고 #234 ④).

⚠️ 판정 순서 — 전량실패 판정은 백필 **앞**이고 판정 대상은 백필 후 값이 아니라 raw fetch
결과다(BH7-L1). 뒤에 두면 저장값이 있는 정상 운영 중엔 백필이 전 심볼을 채워 그 분기가
영영 발동하지 않고, 경고 없이 `_mc_save`가 돌아 `fetched_at`만 갱신된다.
"""
import logging
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _s(etf, name, r1w=None, r1mo=None, r3mo=None):
    return {"name": name, "etf": etf,
            "return_1w": r1w, "return_1mo": r1mo, "return_3mo": r3mo}


_PREV = [
    _s("XLK", "Technology(구)", 1.1, 2.2, 3.3),
    _s("XLF", "Financials(구)", 0.1, 0.2, 0.3),
]


@pytest.fixture
def mod():
    import services.us_sector_service as m
    return m


# ─────────────── ⓐ 부분 실패 → 실패분만 직전값 백필 ───────────────

def test_partial_none_backfills_only_failed_etfs(mod, monkeypatch, caplog):
    """ETF 2개 all-None + 1개 정상 → 저장 페이로드에서 그 2개가 etf 매칭으로 직전값
    복원(name은 이번 fetch 유지)되고 정상 ETF는 새 값 그대로."""
    fetched = [_s("XLK", "Technology"), _s("XLF", "Financials"),
               _s("XLV", "Health Care", 2.0, 4.0, 6.0)]
    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    monkeypatch.setattr(mod, "_load_momentum_strict", lambda: _PREV)
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.INFO):
            out = mod.refresh()

    assert mock_save.call_count == 1
    saved = mock_save.call_args[0][1]["sectors"]
    by_etf = {s["etf"]: s for s in saved}
    assert (by_etf["XLK"]["return_1w"], by_etf["XLK"]["return_1mo"],
            by_etf["XLK"]["return_3mo"]) == (1.1, 2.2, 3.3)
    assert by_etf["XLK"]["name"] == "Technology"      # 옛 이름을 되살리지 않는다
    assert by_etf["XLF"]["return_1w"] == 0.1
    assert by_etf["XLV"]["return_1w"] == 2.0          # 정상 ETF는 그대로
    assert out == saved                               # 반환값과 저장값이 같다
    assert any("백필" in r.message for r in caplog.records)


def test_partial_none_without_previous_etf_stays_none(mod, monkeypatch):
    """직전 저장값에 그 etf가 없으면 all-None 그대로 둔다(없는 값을 지어내지 않는다).
    다른 ETF가 정상이라 저장 자체는 진행된다."""
    fetched = [_s("XLRE", "Real Estate"), _s("XLV", "Health Care", 2.0, 4.0, 6.0)]
    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    monkeypatch.setattr(mod, "_load_momentum_strict", lambda: _PREV)   # XLRE 없음
    with patch.object(mod, "_mc_save") as mock_save:
        mod.refresh()

    saved = {s["etf"]: s for s in mock_save.call_args[0][1]["sectors"]}
    assert saved["XLRE"]["return_1w"] is None
    assert saved["XLRE"]["return_1mo"] is None
    assert saved["XLRE"]["return_3mo"] is None
    assert saved["XLV"]["return_1w"] == 2.0


def test_partial_none_ignores_previous_entries_without_etf_key(mod, monkeypatch):
    """직전값에 etf 키가 없는 항목(구버전 blob)이 섞여도 매칭 dict가 오염되지 않는다."""
    fetched = [_s("XLK", "Technology"), _s("XLV", "Health Care", 2.0, 4.0, 6.0)]
    prev = [{"name": "레거시", "return_1w": 9.9}, _PREV[0]]
    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    monkeypatch.setattr(mod, "_load_momentum_strict", lambda: prev)
    with patch.object(mod, "_mc_save") as mock_save:
        mod.refresh()

    saved = {s["etf"]: s for s in mock_save.call_args[0][1]["sectors"]}
    assert saved["XLK"]["return_1w"] == 1.1


# ─────────────── ⓑ 대조군 — 정상 입력은 계속 값을 낸다 ───────────────

def test_all_success_saves_everything_and_never_loads_previous(mod, monkeypatch):
    """전량 정상 → 전부 갱신·백필 0. `_load_momentum_strict`는 호출조차 안 된다
    (lazy — 불필요한 DB read 방지). 이 축이 없으면 "전부 백필하기"가 통과한다."""
    fetched = [_s("XLK", "Technology", 1.0, 2.0, 5.0),
               _s("XLF", "Financials", -1.0, 0.5, 3.0)]

    def _must_not_be_called():
        raise AssertionError("전량 정상인데 _load_momentum_strict가 호출됨")

    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    monkeypatch.setattr(mod, "_load_momentum_strict", _must_not_be_called)
    with patch.object(mod, "_mc_save") as mock_save:
        out = mod.refresh()

    assert mock_save.call_count == 1
    assert mock_save.call_args[0][1]["sectors"] == fetched
    assert out == fetched


def test_partially_none_within_one_etf_is_not_backfilled(mod, monkeypatch):
    """한 ETF의 *일부* 수익률만 None인 것(히스토리 63봉 미달 등 정상 결과)은 백필 대상이
    아니다 — all-None만 실패로 본다. 이 축이 없으면 정상 결측이 옛 값으로 덮인다."""
    fetched = [_s("XLK", "Technology", 1.0, 2.0, None),
               _s("XLF", "Financials", -1.0, 0.5, 3.0)]

    def _must_not_be_called():
        raise AssertionError("all-None ETF가 없는데 _load_momentum_strict가 호출됨")

    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    monkeypatch.setattr(mod, "_load_momentum_strict", _must_not_be_called)
    with patch.object(mod, "_mc_save") as mock_save:
        mod.refresh()

    saved = {s["etf"]: s for s in mock_save.call_args[0][1]["sectors"]}
    assert saved["XLK"]["return_3mo"] is None


# ─────────────── ⓒⓓ 전량 실패 → 저장 생략 (판정은 백필 *앞*) ───────────────

def test_all_none_skips_save_even_when_previous_exists(mod, monkeypatch, caplog):
    """ⓓ 회귀 핀: 전량 실패 + 직전 저장값 존재 → 그래도 save 생략.

    판정을 백필 *뒤*에 두면(commodities.get_treasury의 옛 결함 형태) 백필이 전 심볼을
    채워 all-None이 사라지고, 이 분기가 영영 발동하지 않아 `fetched_at`만 갱신하는
    거짓 성공이 된다."""
    fetched = [_s("XLK", "Technology"), _s("XLF", "Financials")]
    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    monkeypatch.setattr(mod, "_load_momentum_strict", lambda: _PREV)   # 백필 재료가 *있다*
    with patch.object(mod, "_mc_save") as mock_save:
        with caplog.at_level(logging.WARNING):
            out = mod.refresh()

    mock_save.assert_not_called()
    assert out == fetched
    assert any("all-None" in r.message for r in caplog.records)


def test_empty_fetch_skips_save(mod, monkeypatch):
    """fetch가 통째로 빈 리스트여도 저장하지 않는다(빈 sectors 박제 금지)."""
    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: [])
    with patch.object(mod, "_mc_save") as mock_save:
        assert mod.refresh() == []
    mock_save.assert_not_called()


# ─────────────── 페이로드 필드 열거 핀 ───────────────

def test_saved_payload_has_only_sectors_field(mod, monkeypatch):
    """부분 페이로드 보존은 **필드별**로 필요하다 — KR이 `sectors`만 보고 같은 페이로드의
    `index`를 빠뜨려 보유→업종 매핑을 지운 전례가 있다. US 페이로드는 현재 `sectors`
    하나뿐이므로(보유→섹터 매핑은 analysis_service가 요청 시 holdings의 자기 sector
    필드로 만든다) 필드별 보존 대상이 더 없다. 필드가 늘면 이 핀이 깨져 그 판정을 강제한다."""
    fetched = [_s("XLK", "Technology", 1.0, 2.0, 5.0)]
    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    with patch.object(mod, "_mc_save") as mock_save:
        mod.refresh()

    key, payload = mock_save.call_args[0]
    assert key == mod.CACHE_KEY
    assert set(payload) == {"sectors"}


def test_cold_start_partial_failure_still_saves_partial(mod, monkeypatch):
    """콜드 스타트(`_seed_us_sector_if_empty` 경로) — 직전값이 아예 없는데 부분 실패면
    백필 재료가 없으므로 부분 결과를 그대로 저장한다. 여기서 저장을 생략하면 캐시가
    영영 비어 시드가 성립하지 않는다(대조군 — "재료 없으면 스킵하기"를 배제한다)."""
    fetched = [_s("XLK", "Technology"), _s("XLV", "Health Care", 2.0, 4.0, 6.0)]
    monkeypatch.setattr(mod, "parallel_map", lambda *a, **k: fetched)
    monkeypatch.setattr(mod, "_load_momentum_strict", lambda: [])
    with patch.object(mod, "_mc_save") as mock_save:
        mod.refresh()

    saved = {s["etf"]: s for s in mock_save.call_args[0][1]["sectors"]}
    assert saved["XLK"]["return_1w"] is None
    assert saved["XLV"]["return_1w"] == 2.0
