"""KR 공매도 추이 TR — ka10014(공매도추이요청) 조회·정규화.

market_short_sell 동형 행을 만든다 (KR 전용, 키움 ka10014). 경계: .forge/adr/0009.
ka10014 응답 list_key=`shrts_trnsn`, 행 필드(라이브 프로브 확인):
- shrts_qty        → short_volume  공매도 거래량(주)
- shrts_trde_prica → short_value   공매도 거래대금: **천원 단위** → ×1000 = 원
- trde_wght        → short_ratio   공매도 비중(%) (부호문자열 '+3.44'), 실패 시 None(_pct)
- ovr_shrts_qty    → short_balance 공매도 잔량(주, 미상환 누적)
- close_pric       → close_price   종가(원, 부호문자열 → 절대값). **실패 시 None**(_close_price)
  — 0원 종가는 실패를 유효 시세로 위장한다('wrong < missing'). 수량/금액 필드는 _int(0 폴백).
필수 요청 파라미터: stk_cd, strt_dt, end_dt (YYYYMMDD).
"""
from __future__ import annotations
import datetime as _dt
import logging
import math
from datetime import date
from services.kiwoom import client
from services.utils import today_kst

logger = logging.getLogger(__name__)


def _int(val) -> int:
    """수량·금액 필드 전용 — 실패를 0으로 접는다(거래량 0은 '공매도 없음'이라는 유효값).

    ⚠️ 시세(close_price)에는 쓰지 말 것: 가격 필드는 _close_price(실패 → None).

    `OverflowError`가 except에 있는 이유: `int(float("Infinity"))`는 ValueError가 아니라
    **OverflowError**라 옛 `except ValueError`를 통과해 전파됐고, `parse_rows`가 raise되면
    `short_sell_service.fetch_trend`의 broad except가 그 종목 이력을 조용히 비운다."""
    if val is None:
        return 0
    s = str(val).replace(",", "").strip().lstrip("+")
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
        logger.warning(f"[KiwoomShortSell] close_price 파싱 실패 (close_pric={val!r})")
        return None
    if not math.isfinite(f):
        logger.warning(f"[KiwoomShortSell] close_price 비유한값 (close_pric={val!r})")
        return None
    iv = abs(int(f))
    if iv == 0:
        # 리터럴 0은 **유효 시세가 아니다** — 소스가 결측을 "0"으로 채우면 파싱은
        # 성공하므로 위 가드를 전부 통과한다. 싱크층(consensus_pipeline `tm > 0`)과
        # 같은 판정을 쓴다. KR 주가는 1원 미만이 없으므로 정상값을 지우지 않는다.
        logger.warning(f"[KiwoomShortSell] close_price 0원 — 결측 처리 (close_pric={val!r})")
        return None
    return iv


def _pct(val) -> float | None:
    if val is None:
        return None
    s = str(val).replace("%", "").replace(",", "").strip().lstrip("+")
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


def parse_rows(items: list[dict]) -> list[dict]:
    """ka10014 `shrts_trnsn` 항목 → market_short_sell 동형 행(base_date 오름차순).

    거래대금은 천원→원(×1000) 정규화. 같은 날짜 중복은 마지막 값으로 합쳐진다.
    short_ratio·close_price는 파싱 실패 시 None(market_short_sell의 두 컬럼 모두 nullable)."""
    out: dict = {}
    for r in items:
        d = _to_date(r.get("dt"))
        if d is None:
            continue
        out[d] = {
            "base_date": d,
            "short_volume": abs(_int(r.get("shrts_qty"))),
            "short_value": abs(_int(r.get("shrts_trde_prica"))) * 1000,  # 천원 → 원
            "short_ratio": _pct(r.get("trde_wght")),
            "short_balance": abs(_int(r.get("ovr_shrts_qty"))),
            "close_price": _close_price(r.get("close_pric")),
        }
    # 관측(적대 검토 LOW4) — 행별 `val is None` 조기반환이 로그보다 앞에 있어, 가장
    # 개연성 높은 실패 클래스인 **응답 필드 키 부재·개명**이 무음으로 전 행 None을
    # 만든다(KIS `output` vs `output1/2/3` 오독과 같은 클래스). 전량 결측만 경보한다 —
    # 일부 결측은 정상적인 데이터 공백이므로 경보하면 신호가 죽는다.
    if out and all(v["close_price"] is None for v in out.values()):
        logger.warning(
            f"[KiwoomShortSell] close_price 전량 결측 — 응답 필드(close_pric) 확인 "
            f"(rows={len(out)})"
        )
    return [out[d] for d in sorted(out)]


def fetch_rows(stk_cd: str, days: int = 252, end: str | None = None) -> list[dict]:
    """ka10014 공매도추이 → market_short_sell 동형 행(최근 days 거래일 커버).

    end=기준일 YYYYMMDD(없으면 오늘). 거래일 days를 캘린더 여유로 환산해 범위 조회."""
    end_d = _dt.datetime.strptime(end, "%Y%m%d").date() if end else today_kst()
    strt_d = end_d - _dt.timedelta(days=int(days * 1.6) + 14)  # 거래일→캘린더 여유(주말·휴장)
    items = client.request_paged(
        "ka10014",
        {"stk_cd": stk_cd, "strt_dt": strt_d.strftime("%Y%m%d"), "end_dt": end_d.strftime("%Y%m%d")},
        "shsa", "shrts_trnsn", max_items=days + 50,
    )
    return parse_rows(items)
