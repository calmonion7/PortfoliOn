"""종목 추천 엔진 + 발굴 백엔드 (.forge/adr/0015).

2단 깔때기·점진 유니버스·정량 플래그(LLM 0). 배치가 점수를 사전계산해
stock_recommendations에 저장하고, GET /api/recommendations는 저장값만 읽는다.

공개 API re-export — 후속 슬라이스/소비처는 여기서 import한다.
"""
from __future__ import annotations

from .universe import build_universe
from .scoring import score_stock, derive_flags
from .funnel import run_recommendation_batch
from .store import replace_recommendations, read_recommendations
from .actions import derive_holding_action

__all__ = [
    "build_universe",
    "score_stock",
    "derive_flags",
    "run_recommendation_batch",
    "replace_recommendations",
    "read_recommendations",
    "derive_holding_action",
]
