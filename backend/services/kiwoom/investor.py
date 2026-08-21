"""KR 수급 TR — ka10059(투자자별 순매수)+ka10008(외국인 보유율) 조회·정규화·병합.

investor_service.market_investor_trend 스키마와 동형 행을 만든다:
- 순매수(foreign/organ/individual_net)는 **주식 수량(주)** — ka10059 amt_qty_tp=2, unit_tp=1.
  (기존 Naver foreignerPureBuyQuant도 '수량'이므로 의미 일치. 금액 아님.)
- foreign_hold_ratio는 ka10008 wght(외국인 보유 비중 %).
키움 실패 시 호출측이 Naver 폴백. 경계: .forge/adr/0009.
"""
from __future__ import annotations
import logging
import math
from datetime import date
from services.kiwoom import client
from services.utils import today_kst

logger = logging.getLogger(__name__)


def _signed_int(val) -> int:
    """순매수 3필드 전용 — 실패를 0으로 접는다(순매수 0은 '순매수 없음'이라는 유효값).

    ⚠️ 시세(close_price)에는 쓰지 말 것: 0원 종가는 실패를 유효 시세로 위장한다.
    가격 필드는 _close_price(실패 → None)를 쓴다.

    `OverflowError`가 except에 있는 이유: `int(float("Infinity"))`는 ValueError가 아니라
    **OverflowError**라 옛 `except ValueError`를 통과해 전파됐고, `parse_rows`/`fetch_flows`
    전체가 raise되면 호출측 broad except가 그 종목 이력을 조용히 빈 결과로 만든다."""
    if val is None:
        return 0
    s = str(val).replace(",", "").strip()
    if s in ("", "-", "+", "N/A"):
        return 0
    try:
        f = float(s)
        return int(f) if math.isfinite(f) else 0
    except (ValueError, OverflowError):
        return 0


def _close_price(val) -> int | None:
    """종가 전용 엄격 파서 — 파싱 실패는 0이 아니라 None('wrong < missing').

    형제 _pct와 같은 규약. 비유한값도 None이다 — float("nan")/float("Infinity")는
    ValueError를 던지지 않고, int(inf)는 ValueError가 아닌 OverflowError를 낸다.
    리터럴 0도 None이다(소스가 결측을 "0"으로 채우는 경우 — 0원 종가는 존재하지 않는다).

    ⚠️ 같은 `market_investor_trend.close_price`/`market_short_sell.close_price` 컬럼에
    쓰는 **형제 writer가 셋**이다: `services.kiwoom.investor._close_price` · `services.kiwoom.shortsell._close_price` ·
    `services.investor_service._parse_close_price`. 이 규약(센티널 목록·0 판정·비유한 처리)을 바꾸면
    **셋을 함께** 고칠 것 — 소스별로 0과 None이 섞이면 어느 쪽이 결함인지 코드로 판정할
    수 없게 된다(그것이 이 슬라이스가 세 번째 writer까지 손댄 이유다)."""
    if val is None:
        return None
    s = str(val).replace(",", "").strip()
    if s in ("", "-", "+", "N/A"):
        return None
    try:
        f = float(s)
    except ValueError:
        logger.warning(f"[KiwoomInvestor] close_price 파싱 실패 (cur_prc={val!r})")
        return None
    if not math.isfinite(f):
        logger.warning(f"[KiwoomInvestor] close_price 비유한값 (cur_prc={val!r})")
        return None
    iv = abs(int(f))
    if iv == 0:
        # 리터럴 0은 **유효 시세가 아니다** — 소스가 결측을 "0"으로 채우면 파싱은
        # 성공하므로 위 가드를 전부 통과한다. 싱크층(consensus_pipeline `tm > 0`)과
        # 같은 판정을 쓴다. KR 주가는 1원 미만이 없으므로 정상값을 지우지 않는다.
        logger.warning(f"[KiwoomInvestor] close_price 0원 — 결측 처리 (cur_prc={val!r})")
        return None
    return iv


def _pct(val) -> float | None:
    if val is None:
        return None
    s = str(val).replace("%", "").replace(",", "").strip()
    if s in ("", "-", "+", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _to_date(val) -> date | None:
    s = str(val or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def fetch_flows(stk_cd: str, dt: str | None = None, max_items: int = 100) -> dict:
    """ka10059 순매수(수량/주) → {date: {foreign_net, organ_net, individual_net, close_price}}.
    dt=기준일 YYYYMMDD(없으면 오늘); 그 날짜에서 과거로 시계열.

    순매수 3필드는 int(실패·센티널 → 0, 순매수 0이 유효값), close_price는
    int|None(파싱 실패 → None — 'wrong < missing', 0원 종가로 위장하지 않는다)."""
    dt = dt or today_kst().strftime("%Y%m%d")
    rows = client.request_paged(
        "ka10059",
        {"dt": dt, "stk_cd": stk_cd, "amt_qty_tp": "2", "trde_tp": "0", "unit_tp": "1"},
        "stkinfo", "stk_invsr_orgn", max_items,
    )
    out: dict = {}
    for r in rows:
        d = _to_date(r.get("dt"))
        if d is None:
            continue
        out[d] = {
            "foreign_net": _signed_int(r.get("frgnr_invsr")),
            "organ_net": _signed_int(r.get("orgn")),
            "individual_net": _signed_int(r.get("ind_invsr")),
            "close_price": _close_price(r.get("cur_prc")),
        }
    # 관측(적대 검토 LOW4) — 행별 `val is None` 조기반환이 로그보다 앞에 있어, 가장
    # 개연성 높은 실패 클래스인 **응답 필드 키 부재·개명**이 무음으로 전 행 None을
    # 만든다(KIS `output` vs `output1/2/3` 오독과 같은 클래스). 전량 결측만 경보한다 —
    # 일부 결측은 정상적인 데이터 공백이므로 경보하면 신호가 죽는다.
    if out and all(v["close_price"] is None for v in out.values()):
        logger.warning(
            f"[KiwoomInvestor] close_price 전량 결측 — 응답 필드(cur_prc) 확인 "
            f"(stk_cd={stk_cd}, rows={len(out)})"
        )
    return out


def fetch_foreign_ratio(stk_cd: str, max_items: int = 400) -> dict:
    """ka10008 외국인 보유율 wght(%) → {date: ratio}. max_items로 백필 깊이(≈일수) 커버."""
    rows = client.request_paged("ka10008", {"stk_cd": stk_cd}, "frgnistt", "stk_frgnr", max_items)
    out: dict = {}
    for r in rows:
        d = _to_date(r.get("dt"))
        if d is None:
            continue
        out[d] = _pct(r.get("wght"))
    return out


def fetch_trend_rows(stk_cd: str, dt: str | None = None, max_items: int = 100) -> list[dict]:
    """ka10059+ka10008 병합 → market_investor_trend 동형 행 리스트(base_date 오름차순).

    foreign_hold_ratio는 ka10008이 그 날짜를 커버할 때만 채워지고, 그보다 오래된
    백필 날짜는 None(순매수는 채워짐 — 'wrong < missing'). close_price도 같은
    규약으로 파싱 실패 시 None이며, market_investor_trend.close_price는 nullable."""
    flows = fetch_flows(stk_cd, dt, max_items)
    ratios = fetch_foreign_ratio(stk_cd)
    rows = []
    for d in sorted(flows):
        f = flows[d]
        rows.append({
            "base_date": d,
            "foreign_net": f["foreign_net"],
            "organ_net": f["organ_net"],
            "individual_net": f["individual_net"],
            "foreign_hold_ratio": ratios.get(d),
            "close_price": f["close_price"],
        })
    return rows
