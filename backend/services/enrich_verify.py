"""갱신 대조 판정 (순수 함수) — 야간 enrich fire 결과를 다음날 대조한다 (ADR 260916-132605).

02:00 배치는 「fire 접수됨」만 기록하고 실제 갱신 여부는 모른다. `judge()`가 그 대조를
한다: 쏜 목록(fired)과 현재 `tickers.enriched_at`(enriched)을 window_start 기준으로
비교해 success/partial/failed/skipped 4분기와 미갱신 목록을 낸다.

계약:
- `fired`: 02:00에 실제로 쏜 ticker 목록.
- `enriched`: ticker -> datetime|None (현재 tickers.enriched_at). 키가 없거나 값이
  None이면 미갱신으로 센다.
- `window_start`: 이 시각 **이상**(`>=`, 포함)이면 갱신된 것으로 본다.
- tz 계약: window_start와 enriched 값의 tzinfo 유무가 어긋나면(aware vs naive) 그
  비교는 원리적으로 불가하다(`TypeError`) — 이 함수는 그런 경우를 **미갱신으로
  처리**한다(조용히 통과시키지 않고 명시 분기). 호출측이 두 입력을 같은 tz 계약(둘
  다 aware 권장)으로 맞춰 넘길 책임은 그대로 남는다.
- 순수 함수 — DB·시계·로깅 부작용 없음. `datetime.now()`를 부르지 않는다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Tuple

Judgement = Tuple[str, List[str]]


def judge(
    fired: List[str],
    enriched: Dict[str, Optional[datetime]],
    window_start: datetime,
) -> Judgement:
    if not fired:
        return "skipped", []

    missing = []
    for ticker in fired:
        at = enriched.get(ticker)
        if at is None:
            missing.append(ticker)
            continue
        try:
            updated = at >= window_start
        except TypeError:
            # tz-aware/naive 혼용 등 비교 불가 → 미갱신(정의는 위 docstring 참조)
            updated = False
        if not updated:
            missing.append(ticker)

    if not missing:
        return "success", []
    missing.sort()
    if len(missing) == len(fired):
        return "failed", missing
    return "partial", missing
