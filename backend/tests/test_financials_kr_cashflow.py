"""
KR 연간 FCF·이자보상 DART 증강 테스트.
account_nm은 일부러 변형해 account_id 기반 매칭만 동작함을 증명.
"""
from unittest.mock import patch, MagicMock

# Naver 연간 픽스처 (1 period, 억원 단위)
_NAVER_ANNUAL = {
    "financeInfo": {
        "trTitleList": [{"key": "2023", "isConsensus": "N"}],
        "rowList": [
            {"columns": {"2023": {"value": "100000"}}},  # 0 revenue
            {"columns": {"2023": {"value": "10000"}}},   # 1 op_income
            {"columns": {"2023": {"value": "8000"}}},    # 2 net_income
            {"columns": {"2023": {"value": "7000"}}},    # 3
            {"columns": {"2023": {"value": "1000"}}},    # 4
            {"columns": {"2023": {"value": "10.00"}}},   # 5 op_margin
            {"columns": {"2023": {"value": "8.00"}}},    # 6 net_margin
            {"columns": {"2023": {"value": "12.00"}}},   # 7 ROE
            {"columns": {"2023": {"value": "50.00"}}},   # 8 debt_ratio
            {"columns": {"2023": {"value": "120.00"}}},  # 9 quick_ratio
            {"columns": {"2023": {"value": "300"}}},     # 10
            {"columns": {"2023": {"value": "5000"}}},    # 11 EPS
            {"columns": {"2023": {"value": "10.0"}}},    # 12 PER
            {"columns": {"2023": {"value": "50000"}}},   # 13 BPS
            {"columns": {"2023": {"value": "1.0"}}},     # 14 PBR
            {"columns": {"2023": {"value": "500"}}},     # 15
        ],
    }
}

# DART fnlttSinglAcntAll 픽스처 — account_nm 일부러 변형해 account_id 매칭 증명
# OCF=15조, CapEx=5조, EBIT=10조, 이자지급=2조 (thstrm만; frmtrm/bfefrmtrm도 포함)
_DART_LIST = [
    {"fs_div": "CFS", "account_id": "ifrs-full_CashFlowsFromUsedInOperatingActivities",
     "account_nm": "영업활동으로 인한 현금흐름(변형)",       # nm 변형
     "thstrm_amount": "15,000,000,000,000",
     "frmtrm_amount": "14,000,000,000,000",
     "bfefrmtrm_amount": "13,000,000,000,000"},
    {"fs_div": "CFS",
     "account_id": "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
     "account_nm": "유형자산 취득(임의변형)",                 # nm 변형
     "thstrm_amount": "5,000,000,000,000",
     "frmtrm_amount": "4,500,000,000,000",
     "bfefrmtrm_amount": "4,000,000,000,000"},
    {"fs_div": "CFS", "account_id": "ifrs-full_InterestPaidClassifiedAsOperatingActivities",
     "account_nm": "이자지급(임의변형)",                      # nm 변형
     "thstrm_amount": "2,000,000,000,000",
     "frmtrm_amount": "1,800,000,000,000",
     "bfefrmtrm_amount": "1,600,000,000,000"},
    {"fs_div": "CFS", "account_id": "dart_OperatingIncomeLoss",
     "account_nm": "영업이익(임의변형)",                      # nm 변형
     "thstrm_amount": "10,000,000,000,000",
     "frmtrm_amount": "9,000,000,000,000",
     "bfefrmtrm_amount": "8,000,000,000,000"},
]


def _dart_resp(status="000", list_data=None):
    return {"status": status, "list": list_data if list_data is not None else _DART_LIST}


def test_fcf_and_coverage_matched():
    """thstrm: FCF = OCF − CapEx, coverage = EBIT / 이자지급."""
    with patch("backend.services.market.kr._naver_get", return_value=_NAVER_ANNUAL), \
         patch("backend.services.market.kr.requests.get") as mock_req, \
         patch("os.environ.get", side_effect=lambda k, d="": "dummy-key" if k == "DART_API_KEY" else d), \
         patch("backend.services.market.kr._get_corp_code_map_from_backlog",
               return_value={"005930": "00126380"}, create=True):

        # patch _get_corp_code_map inside the function's import
        with patch("services.backlog._get_corp_code_map", return_value={"005930": "00126380"}):
            mock_resp = MagicMock()
            mock_resp.json.return_value = _dart_resp()
            mock_req.return_value = mock_resp

            from backend.services.market.kr import get_annual_financials_kr
            results = get_annual_financials_kr("005930")

    assert results, "결과 비어있음"
    item = results[0]
    assert item["period"] == "2023"
    # FCF = 15조 − 5조 = 10조 원
    assert item["fcf"] == 15_000_000_000_000 - 5_000_000_000_000
    # coverage = 10조 / 2조 = 5.0
    assert item["interest_coverage"] == 5.0
    # fnlttSinglAcntAll은 fs_div를 요청 필수값으로 받는다(없으면 status 100) — 회귀 가드
    assert mock_req.call_args.kwargs["params"].get("fs_div") in ("CFS", "OFS")


def test_no_dart_key_graceful():
    """DART_API_KEY 없으면 fcf/coverage 전부 None, 함수 안 깨짐."""
    with patch("backend.services.market.kr._naver_get", return_value=_NAVER_ANNUAL), \
         patch("os.environ.get", side_effect=lambda k, d="": "" if k == "DART_API_KEY" else d):

        from backend.services.market.kr import get_annual_financials_kr
        results = get_annual_financials_kr("005930")

    assert results
    item = results[0]
    assert item["fcf"] is None
    assert item["interest_coverage"] is None


def test_dart_status_non_000_graceful():
    """DART status != '000' → fcf/coverage None, 정상 반환."""
    with patch("backend.services.market.kr._naver_get", return_value=_NAVER_ANNUAL), \
         patch("backend.services.market.kr.requests.get") as mock_req, \
         patch("os.environ.get", side_effect=lambda k, d="": "dummy-key" if k == "DART_API_KEY" else d):

        with patch("services.backlog._get_corp_code_map", return_value={"005930": "00126380"}):
            mock_resp = MagicMock()
            mock_resp.json.return_value = _dart_resp(status="013")
            mock_req.return_value = mock_resp

            from backend.services.market.kr import get_annual_financials_kr
            results = get_annual_financials_kr("005930")

    assert results
    assert results[0]["fcf"] is None
    assert results[0]["interest_coverage"] is None
