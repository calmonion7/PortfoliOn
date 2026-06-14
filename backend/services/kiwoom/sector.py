"""KR 업종 지수 TR — ka20006(업종일봉) 종가 series + ka20002(업종별주가) 종목 매핑.

분석탭 섹터 모멘텀의 KR 확장(task 48)에 쓴다. 키움은 KR 읽기전용 시세 소스
(경계: .forge/adr/0009 — 조회 TR만). 업종 응답은 부호 포함 문자열·최신→과거 순이라
종가를 절대값·오름차순(과거→현재)으로 정규화한다.
"""
from __future__ import annotations
from services.kiwoom import client

# KOSPI 업종 큐레이션 — 라이브 ka10101(mrkt_tp=0) 프로브로 확인(2026-06).
# 실제 산업 업종(005~030)만. 규모지수(001 종합/002 대형/003 중형/004 소형)·
# 특수지수(603 변동성/604/605)는 제외(섹터 모멘텀 비교 대상이 아님).
KOSPI_SECTORS = [
    {"code": "005", "name": "음식료/담배"},
    {"code": "006", "name": "섬유/의류"},
    {"code": "007", "name": "종이/목재"},
    {"code": "008", "name": "화학"},
    {"code": "009", "name": "제약"},
    {"code": "010", "name": "비금속"},
    {"code": "011", "name": "금속"},
    {"code": "012", "name": "기계/장비"},
    {"code": "013", "name": "전기/전자"},
    {"code": "014", "name": "의료/정밀기기"},
    {"code": "015", "name": "운송장비/부품"},
    {"code": "016", "name": "유통"},
    {"code": "017", "name": "전기/가스"},
    {"code": "018", "name": "건설"},
    {"code": "019", "name": "운송/창고"},
    {"code": "020", "name": "통신"},
    {"code": "021", "name": "금융"},
    {"code": "024", "name": "증권"},
    {"code": "025", "name": "보험"},
    {"code": "026", "name": "일반서비스"},
    {"code": "027", "name": "제조"},
    {"code": "028", "name": "부동산"},
    {"code": "029", "name": "IT 서비스"},
    {"code": "030", "name": "오락/문화"},
]


def _num(val) -> float | None:
    if val is None:
        return None
    s = str(val).strip().replace(",", "")
    if s in ("", "-", "+"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def normalize_closes(rows: list) -> list[float]:
    """ka20006 LIST → 일자 오름차순(과거→현재) 종가 float 리스트. 부호 절대값."""
    pairs = []
    for r in rows:
        dt = (r.get("dt") or "").strip()
        close = _num(r.get("cur_prc"))
        if not dt or close is None:
            continue
        pairs.append((dt, abs(close)))
    pairs.sort(key=lambda p: p[0])
    return [c for _, c in pairs]


def fetch_sector_closes(inds_cd: str, base_dt: str | None = None,
                        max_items: int = 100) -> list[float]:
    """업종 일봉 종가 series(과거→현재). base_dt 미지정 시 오늘 기준.

    ka20006(업종일봉조회)는 한 페이지에 600개를 주므로 1콜로 끝난다. 최근 max_items개로 절단.
    """
    import datetime as _dt
    base_dt = base_dt or _dt.date.today().strftime("%Y%m%d")
    rows = client.request_paged(
        "ka20006", {"inds_cd": inds_cd, "base_dt": base_dt},
        "chart", "inds_dt_pole_qry", max_items,
    )
    closes = normalize_closes(rows)
    return closes[-max_items:] if max_items and len(closes) > max_items else closes


def fetch_sector_stocks(inds_cd: str) -> list[str]:
    """ka20002(업종별주가)로 해당 KOSPI 업종에 속한 종목코드 리스트(6자리).

    holding→업종 역인덱스용. LIST 키 inds_stkpc, 종목코드 필드 stk_cd(라이브 프로브 확인).
    """
    rows = client.request_paged(
        "ka20002", {"mrkt_tp": "0", "inds_cd": inds_cd, "stex_tp": "1"},
        "sect", "inds_stkpc", max_items=5000,
    )
    out = []
    for r in rows:
        code = (r.get("stk_cd") or "").strip()
        if code:
            out.append(code)
    return out
