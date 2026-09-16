"""Claude Code 루틴 fire — 이벤트 구동 분석 파이프라인의 백엔드 쪽 절반 (ADR-0028, task#213).

일일 리포트 배치 완료 직후(또는 admin 수동) 루틴을 HTTP POST로 깨운다.
백엔드는 LLM을 호출하지 않는다 — fire는 트리거 POST 1개뿐(무LLM 원칙 유지).

env(.env.docker): COWORK_ROUTINE_FIRE_URL, COWORK_ROUTINE_FIRE_TOKEN — 미설정 시 휴면(dormant-safe).
실패는 로깅만 하고 전파하지 않는다(best-effort — 배치 본문을 깨뜨리지 않음).
"""
from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 15


def configured() -> bool:
    return bool(os.environ.get("COWORK_ROUTINE_FIRE_URL") and os.environ.get("COWORK_ROUTINE_FIRE_TOKEN"))


def daily_text(market: str) -> str:
    """일배치 완료 트리거 본문 — 정책 정본은 루틴 프롬프트다, 여기서 열거하지 않는다(task#279).

    개별 정책명·상한값을 담으면 그 열거가 프롬프트와 드리프트해 프롬프트 정본을
    이겨버린다(주요기술 리포트 0건 발행의 근본원인) — 이 함수가 유일한 산지여야 한다.
    """
    return f"{market} 일일 리포트 배치 완료 — 프롬프트에 정의된 전 정책을 순서대로 검토해 수행하라."


def manual_text() -> str:
    """admin 수동 fire 기본 본문 — daily_text와 동일 원칙(정책 열거 금지, task#279)."""
    return "수동 트리거 — 프롬프트에 정의된 전 정책을 순서대로 검토해 수행하라."


def nightly_text() -> str:
    """대상 지정 enrich 회차 본문(야간 갱신·온디맨드 갱신 공용) — 상한·게이트는 프롬프트 §1이 정본이다(정책 열거 금지).

    대상 종목은 이 본문이 아니라 payload의 `tickers`로 넘어가고, 리스너가 청크마다
    `[대상 종목]` 블록으로 붙인다. 야간 회차의 대상은 갱신 대상 집합이다(ADR 260916-132605).
    """
    return "대상 지정 enrich 회차 — 트리거에 명시된 종목만 enrich·재생성하고 다른 정책은 수행하지 말라."


def fire(text: str, *, tickers: list | None = None, model: str | None = None,
         chunk: int | None = None) -> bool:
    """루틴 트리거 발사. 성공 True / 미설정·실패 False (예외 전파 없음).

    확장 3키는 **additive**다 — None이면 payload에서 통째로 생략되므로 기존 호출의
    본문은 `{"text": ...}`로 바이트 동일하다(리스너 구버전 무회귀).
    """
    if not configured():
        return False
    url = os.environ["COWORK_ROUTINE_FIRE_URL"]
    payload: dict = {"text": text}
    if tickers is not None:
        payload["tickers"] = tickers
    if model is not None:
        payload["model"] = model
    if chunk is not None:
        payload["chunk"] = chunk
    try:
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {os.environ['COWORK_ROUTINE_FIRE_TOKEN']}"},
            json=payload,
            timeout=_TIMEOUT,
        )
        if r.status_code >= 300:
            logger.warning(f"[CoworkTrigger] fire 실패 (HTTP {r.status_code}): {r.text[:200]}")
            return False
        logger.info(f"[CoworkTrigger] fire 성공: {text[:80]}")
        return True
    except Exception as e:
        logger.warning(f"[CoworkTrigger] fire 실패: {e}")
        return False
