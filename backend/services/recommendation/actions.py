"""보유 액션 도출 순수 함수 (.forge/adr/0015 §5/§6, part 4/4 S1).

점수·비중·손익을 받아 행동(추매/익절/홀딩)과 한국어 정량 사유를 돌려준다.
DB/네트워크 무의존 순수 함수. 색은 백엔드가 결정하지 않는다 — action enum과
정량 사유 문자열만 반환하고, 색(KR 가격색 vs 의미색)은 프론트가 정한다.
"""
from __future__ import annotations

# 임계 상수
HI_SCORE = 70          # 추매 진입 점수 하한(>=)
LO_SCORE = 45          # 익절 진입 점수 상한(<=) — 40→45 상향(task#132, 000660 라이브 관찰)
ADD_WEIGHT_CAP = 10    # 추매 허용 비중 상한(%) — strict <
TAKE_PROFIT_PNL = 15   # 익절 진입 손익 하한(%) — >=


def derive_holding_action(score, weight_pct, pnl_pct) -> dict:
    """보유 종목의 행동·사유 도출.

    규칙(우선순위 순):
      - 추매 = score>=HI_SCORE AND weight_pct<ADD_WEIGHT_CAP (strict <)
      - 익절 = score<=LO_SCORE AND pnl_pct>=TAKE_PROFIT_PNL
      - 홀딩 = 그 외
    score/weight_pct/pnl_pct 중 하나라도 None이면 → 홀딩 + ["데이터 부족"].

    반환: {"action": "추매"|"익절"|"홀딩", "reasons": [한국어 한 줄, ...]}.
    """
    if score is None or weight_pct is None or pnl_pct is None:
        return {"action": "홀딩", "reasons": ["데이터 부족"]}

    if score >= HI_SCORE and weight_pct < ADD_WEIGHT_CAP:
        return {
            "action": "추매",
            "reasons": [
                f"점수 {score:.0f}점(>= {HI_SCORE})으로 매력 상위",
                f"비중 {weight_pct:.1f}%(< {ADD_WEIGHT_CAP}%)로 추가 여력 있음",
            ],
        }

    if score <= LO_SCORE and pnl_pct >= TAKE_PROFIT_PNL:
        return {
            "action": "익절",
            "reasons": [
                f"점수 {score:.0f}점(<= {LO_SCORE})으로 매력 저하",
                f"수익률 +{pnl_pct:.1f}%(>= {TAKE_PROFIT_PNL}%)로 이익 실현 구간",
            ],
        }

    return {
        "action": "홀딩",
        "reasons": [
            f"점수 {score:.0f}점·비중 {weight_pct:.1f}%·손익 {pnl_pct:+.1f}% — 조건 미충족",
        ],
    }
