# backend/tests/test_recommendation_actions.py
"""S1 — 보유 액션 도출 순수 함수 테스트 (TDD).

derive_holding_action(score, weight_pct, pnl_pct) → {"action", "reasons"}.
규칙(우선순위): 추매(score>=70 AND weight<10) → 익절(score<=40 AND pnl>=15) → 홀딩.
결측(None 하나라도) → 홀딩 + ["데이터 부족"]. 색은 백엔드 미결정(action enum + 한국어 사유만).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from services.recommendation import derive_holding_action
from services.recommendation.actions import (
    HI_SCORE, LO_SCORE, ADD_WEIGHT_CAP, TAKE_PROFIT_PNL,
)


def test_module_constants():
    assert HI_SCORE == 70
    assert LO_SCORE == 40
    assert ADD_WEIGHT_CAP == 10
    assert TAKE_PROFIT_PNL == 15


# --- 추매: score>=70 AND weight<10 (strict <) ---

def test_add_when_high_score_low_weight():
    r = derive_holding_action(80.0, 5.0, 3.0)
    assert r["action"] == "추매"
    assert isinstance(r["reasons"], list) and r["reasons"]
    assert all(isinstance(x, str) for x in r["reasons"])


def test_add_boundary_score_70_weight_99():
    # score 정확히 70(>=) AND weight 9.9(<10) → 추매
    r = derive_holding_action(70.0, 9.9, 0.0)
    assert r["action"] == "추매"


def test_no_add_score_69():
    # score 69 < 70 → 추매 아님 → 홀딩
    r = derive_holding_action(69.0, 5.0, 0.0)
    assert r["action"] == "홀딩"


def test_no_add_weight_exactly_cap():
    # weight 10.0은 strict < 위반 → 추매 아님 → 홀딩
    r = derive_holding_action(80.0, 10.0, 0.0)
    assert r["action"] == "홀딩"


# --- 익절: score<=40 AND pnl>=15 ---

def test_take_profit_low_score_high_pnl():
    r = derive_holding_action(30.0, 5.0, 25.0)
    assert r["action"] == "익절"
    assert r["reasons"]


def test_take_profit_boundary_score_40_pnl_15():
    # score 정확히 40(<=) AND pnl 정확히 15(>=) → 익절
    r = derive_holding_action(40.0, 5.0, 15.0)
    assert r["action"] == "익절"


def test_no_take_profit_score_41():
    # score 41 > 40 → 익절 아님 → 홀딩
    r = derive_holding_action(41.0, 5.0, 25.0)
    assert r["action"] == "홀딩"


def test_no_take_profit_pnl_149():
    # pnl 14.9 < 15 → 익절 아님 → 홀딩
    r = derive_holding_action(30.0, 5.0, 14.9)
    assert r["action"] == "홀딩"


# --- 홀딩: 그 외 ---

def test_hold_mid_score():
    r = derive_holding_action(55.0, 5.0, 5.0)
    assert r["action"] == "홀딩"
    assert r["reasons"]


def test_add_takes_priority_over_take_profit_is_impossible():
    # score>=70 와 score<=40 은 동시 불가 → 우선순위 충돌 케이스 없음(샘플로 추매 확인)
    r = derive_holding_action(75.0, 2.0, 30.0)
    assert r["action"] == "추매"


# --- 결측 → 홀딩 + ["데이터 부족"] ---

def test_missing_score():
    r = derive_holding_action(None, 5.0, 5.0)
    assert r == {"action": "홀딩", "reasons": ["데이터 부족"]}


def test_missing_weight():
    r = derive_holding_action(80.0, None, 5.0)
    assert r == {"action": "홀딩", "reasons": ["데이터 부족"]}


def test_missing_pnl():
    r = derive_holding_action(80.0, 5.0, None)
    assert r == {"action": "홀딩", "reasons": ["데이터 부족"]}
