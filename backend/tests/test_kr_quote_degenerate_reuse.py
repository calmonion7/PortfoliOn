"""task#137 — KR 시세 degenerate의 KIS/Naver 재호출 제거.

4피드 합의 실패로 escalation이 KIS·Naver를 이미 호출한 뒤 degenerate로 떨어지면,
pre-fetched 결과를 재사용해 같은 소스를 재호출(중복 HTTP)하지 않아야 한다.
outage 경로(kfeeds<2, escalation 미진입)는 pre-fetch가 없으므로 기존 lazy 호출 유지.
"""
from unittest.mock import patch


# 4피드 전부 상호 2x([0.5,2.0]) 밖 → 합의 불가 → degenerate 폴백.
# degenerate self-check(±30%): NXT 0.5x·KIS 0.4x 폐기 → Naver 1.0x 채택.
_NXT = (100.0, 0.5, 200.0, 1e9, "테스트")        # 100/200=0.5 → not sane
_KRX = (1_000.0, 0.3, 1_000.0, 1e9, "테스트")
_KIS = (10_000.0, 0.5, 25_000.0, 1e9, "테스트")   # 0.4 → not sane
_NAVER = (100_000.0, 0.5, 100_000.0, 1e9, "테스트")  # 1.0 → sane


def test_degenerate_reuses_escalation_feeds():
    """4피드 합의 실패 → degenerate가 escalation의 KIS/Naver 결과를 재사용(call_count 각 1)."""
    with patch("services.market.kr._kr_basic_kiwoom") as mock_kiwoom, \
         patch("services.market.kr._kr_basic_kis", return_value=_KIS) as mock_kis, \
         patch("services.market.kr._kr_basic_naver", return_value=_NAVER) as mock_naver:
        mock_kiwoom.side_effect = lambda t, regular=False: _KRX if regular else _NXT

        from services.market.kr import _kr_pick_basic
        result = _kr_pick_basic("005930", ref_close=None, regular=False)

    assert result is not None
    assert result[0] == 100_000.0, f"degenerate가 sane한 Naver를 채택해야 함: {result[0]}"
    assert mock_kis.call_count == 1, f"KIS 재호출 금지(escalation 1회만): {mock_kis.call_count}"
    assert mock_naver.call_count == 1, f"Naver 재호출 금지(escalation 1회만): {mock_naver.call_count}"


def test_outage_path_keeps_lazy_calls():
    """키움 outage(kfeeds<2, escalation 미진입) → degenerate가 KIS를 lazy 호출(기존 동작),
    KIS가 sane이면 short-circuit으로 Naver 미호출."""
    kis_sane = (10_000.0, 0.5, 10_100.0, 1e9, "테스트")
    with patch("services.market.kr._kr_basic_kiwoom", return_value=None), \
         patch("services.market.kr._kr_basic_kis", return_value=kis_sane) as mock_kis, \
         patch("services.market.kr._kr_basic_naver") as mock_naver:
        from services.market.kr import _kr_pick_basic
        result = _kr_pick_basic("005930", ref_close=None, regular=False)

    assert result == kis_sane
    assert mock_kis.call_count == 1
    assert mock_naver.call_count == 0, "lazy short-circuit: KIS sane이면 Naver 미호출"
