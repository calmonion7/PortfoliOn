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


def fire(text: str) -> bool:
    """루틴 트리거 발사. 성공 True / 미설정·실패 False (예외 전파 없음)."""
    if not configured():
        return False
    url = os.environ["COWORK_ROUTINE_FIRE_URL"]
    try:
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {os.environ['COWORK_ROUTINE_FIRE_TOKEN']}"},
            json={"text": text},
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
