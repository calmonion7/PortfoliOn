"""S2 — KR 시세 escalation eager 호출 격리.

NXT/KRX 발산(합의 실패) → escalation 진입 시 Naver가 예외를 올려도
KIS 결과가 있으면 _kr_pick_basic이 예외를 삼키고 값을 반환하는지 검증.
"""
from unittest.mock import patch


# NXT: 70_000, KRX: 354_000 → ratio 약 5배 → 2x 범위 훨씬 초과 → 합의 실패 → escalation
_NXT = (70_000.0, 0.5, 69_650.0, 5_000_000_000.0, "삼성전자")
_KRX = (354_000.0, 0.3, 353_000.0, 5_000_000_000.0, "삼성전자")
# KIS: NXT와 합의하는 값 (70_000 기준 2x 이내)
_KIS = (71_000.0, 0.5, 70_650.0, 5_000_000_000.0, "삼성전자")


def test_naver_exception_does_not_abort_escalation():
    """Naver가 네트워크 예외를 올려도 KIS 결과로 합의해 값을 반환한다."""
    with patch("services.market.kr._kr_basic_kiwoom") as mock_kiwoom, \
         patch("services.market.kr._kr_basic_kis", return_value=_KIS), \
         patch("services.market.kr._kr_basic_naver", side_effect=RuntimeError("Naver 503")):
        # regular=False(NXT) → True(KRX) 순서로 두 번 호출됨
        mock_kiwoom.side_effect = lambda t, regular=False: _KRX if regular else _NXT

        from services.market.kr import _kr_pick_basic
        result = _kr_pick_basic("005930", ref_close=None, regular=False)

    assert result is not None, "Naver 예외에도 값이 반환돼야 함"
    # KIS(71_000)와 NXT(70_000)가 2x 이내 합의 → 우선순위 낮은 NXT(rank 0) 또는 KIS(rank 1) 반환
    # _corroborated_pick은 rank 최소(NXT=0)를 반환
    assert result[0] in (70_000.0, 71_000.0), f"예상치 못한 price: {result[0]}"
