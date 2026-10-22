"""발행 엔드포인트 422의 *사유*를 단언하는 공유 헬퍼 (task#401).

상태코드만 보면 픽스처가 옛 계약일 때 엉뚱한 이유로 422가 나도 통과한다(task#392 — 렌즈 10 필수화 뒤
9렌즈 픽스처가 「렌즈 수 부족」으로 422를 받아 음성 테스트들이 대상에 닿지 않았다). 그래서 「422가 났다」가
아니라 「*그* 이유로 422가 났다」를 단언한다. 판정은 detail 에 맞는 항목이 **하나 이상** 있는지다
(v1 본문 거부처럼 오류가 여러 개인 경우가 있어 「정확히 하나」는 보지 않는다).

- 필드 오류(pydantic `type` = too_short·extra_forbidden·missing …): `loc` 완전 일치 + `type`
- 모델 검증 오류(`type=value_error`): `loc` + `msg` 의 안정적인 한국어 조각 — 본문 단위 검증기는 loc 이 ('body',)
  뿐이라 msg 가 유일한 판별자다
- 라우터 HTTPException(detail 이 문자열): `msg` 부분 문자열
"""


def assert_rejected(resp, *, loc=None, type=None, msg=None):
    assert resp.status_code == 422, f"422 기대, 실제 {resp.status_code}: {resp.text}"
    detail = resp.json()["detail"]
    if isinstance(detail, str):
        assert loc is None and type is None and msg, "문자열 detail 은 msg 조각으로만 맞춘다"
        assert msg in detail, f"사유 {msg!r} 없음 — 실제 detail: {detail!r}"
        return
    # loc 접두 일치는 쓰지 않는다 — ('body',) 가 모든 오류에 맞아 버린다
    assert loc is not None and (type or msg), "목록 detail 은 loc + (type | msg) 로 맞춘다"
    for e in detail:
        if (tuple(e["loc"]) == tuple(loc)
                and (type is None or e["type"] == type)
                and (msg is None or msg in e["msg"])):
            return
    raise AssertionError(f"사유 loc={tuple(loc)} type={type!r} msg={msg!r} 없음 — 실제 detail: {detail!r}")
