# backend/services/rate_limit.py
"""무인증 bcrypt 엔드포인트(login/register)용 IP 슬라이딩 윈도우 레이트리밋.

⚠️ 단일 프로세스 가정: `backend/Dockerfile`의 CMD에 `--workers`가 없어 uvicorn이
단일 프로세스로 뜬다. 이 모듈의 인메모리 카운터는 그 가정에 의존해 정확하다 —
누가 워커를 늘리면 각 워커가 독립된 카운터를 가져 실효 임계가 워커 수만큼 곱해진다.

키는 `CF-Connecting-IP`만 신뢰한다(`client_ip`). `X-Forwarded-For`는 공격자가 임의로
넣어 버킷을 무한 생성해 리밋을 우회할 수 있어 쓰지 않는다 — 헤더가 없으면
`request.client.host`(전 사용자가 한 버킷 = 의도된 페일클로즈)로 폴백한다.

⚠️ 동시성: `login`/`register`는 sync `def`라 Starlette가 스레드풀에서 병렬 실행한다.
`check()`의 판정-후-기록(check-then-act)이 `_lock` 없이는 경합 창을 만든다 —
동시 요청이 같은 키의 만료 판정을 동시에 통과해 `popleft()`가 빈 deque에서
IndexError를 던지거나(만료 경계), `len(bucket) >= limit` 판정을 모두 통과해
limit을 넘겨 통과시키거나(과다 허용), 신규 키 생성이 서로를 덮어써 기록 1건이
소실될 수 있다(task#337 적대적 리뷰가 스레드 barrier로 3종 모두 재현). 그래서
`check()`는 전체를 `_lock`으로 감싼다 — bcrypt는 이 락 진입 *전에* 걸러지므로
락은 짧은 dict/deque 조작만 보호하고 bcrypt 호출을 직렬화하지 않는다.

근거: .forge/adr/260823-085145-auth-rate-limit-in-process-cf-ip.md
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
from typing import Optional

from starlette.requests import Request

_MAX_KEYS = 10_000

# 키 → 시도 타임스탬프(monotonic) deque. OrderedDict라 접근 시 move_to_end로
# LRU 순서를 유지 — 상한 초과 시 맨 앞(가장 오래 안 쓴 키)을 축출한다.
_buckets: "OrderedDict[str, deque]" = OrderedDict()

# check()의 판정+기록을 원자화하는 락 — 위 모듈 docstring "동시성" 참조.
_lock = threading.Lock()


def client_ip(request: Request) -> str:
    cf = request.headers.get("CF-Connecting-IP")
    if cf:
        return cf
    return request.client.host if request.client else "unknown"


def check(key: str, limit: int, window_s: float, now: Optional[float] = None) -> Optional[float]:
    """key가 window_s 안에 limit회 미만이면 이 호출을 기록하고 None(허용) 반환.

    임계 이상이면 기록하지 않고(호출 자체를 세지 않음) 재시도까지 남은 초(float,
    >=0)를 반환한다 — 호출측이 이 값의 유무로 허용/거부를 판정한다(시간 주입 가능한
    순수 판정부; `now`를 안 주면 `time.monotonic()`을 쓴다).

    스레드 안전 — 판정과 기록 전체를 `_lock`으로 감싼다(위 모듈 docstring 참조).
    """
    if now is None:
        now = time.monotonic()
    with _lock:
        bucket = _buckets.get(key)
        if bucket is None:
            bucket = deque()
            _buckets[key] = bucket
        else:
            _buckets.move_to_end(key)
        while bucket and now - bucket[0] > window_s:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(0.0, window_s - (now - bucket[0]))
            _evict_excess()
            return retry_after
        bucket.append(now)
        _evict_excess()
        return None


def _evict_excess() -> None:
    """호출측이 `_lock`을 쥔 채로만 불러야 한다 — 자체 락을 잡지 않는다."""
    while len(_buckets) > _MAX_KEYS:
        _buckets.popitem(last=False)


def reset() -> None:
    """테스트 전용 — 프로세스 전역 상태를 비운다."""
    with _lock:
        _buckets.clear()
