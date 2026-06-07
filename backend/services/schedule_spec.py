"""통합 배치 스케줄 스펙(batch_schedules.data) 검증.

4패턴: daily / weekly / monthly / interval. 잘못되면 ValueError."""
import re

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
_DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_DAY_LABELS = {"mon": "월", "tue": "화", "wed": "수", "thu": "목", "fri": "금", "sat": "토", "sun": "일"}
_TYPES = {"daily", "weekly", "monthly", "interval"}


def _validate_time(spec: dict) -> None:
    time = spec.get("time")
    if not isinstance(time, str) or not _TIME_RE.match(time):
        raise ValueError(f"invalid time: {time!r} (expected HH:MM)")


def validate_schedule_spec(spec: dict) -> None:
    if not isinstance(spec, dict):
        raise ValueError("spec must be a dict")
    if not isinstance(spec.get("enabled"), bool):
        raise ValueError("enabled must be a bool")
    typ = spec.get("type")
    if typ not in _TYPES:
        raise ValueError(f"invalid type: {typ!r} (expected one of {sorted(_TYPES)})")

    if typ == "daily":
        _validate_time(spec)
    elif typ == "weekly":
        days = spec.get("days")
        if not isinstance(days, list) or not days or not set(days) <= _DAYS:
            raise ValueError(f"invalid days: {days!r} (non-empty subset of {sorted(_DAYS)})")
        _validate_time(spec)
    elif typ == "monthly":
        dom = spec.get("day_of_month")
        if not isinstance(dom, int) or isinstance(dom, bool) or not (1 <= dom <= 31):
            raise ValueError(f"invalid day_of_month: {dom!r} (expected 1..31)")
        _validate_time(spec)
    elif typ == "interval":
        every = spec.get("every_minutes")
        if not isinstance(every, int) or isinstance(every, bool) or every < 5:
            raise ValueError(f"invalid every_minutes: {every!r} (expected int >= 5)")
        for key in ("start_hour", "end_hour"):
            val = spec.get(key)
            if not isinstance(val, int) or isinstance(val, bool) or not (0 <= val <= 23):
                raise ValueError(f"invalid {key}: {val!r} (expected 0..23)")
        if spec["start_hour"] > spec["end_hour"]:
            raise ValueError("start_hour must be <= end_hour")


def build_trigger_kwargs(spec: dict) -> dict:
    """검증된 spec을 APScheduler CronTrigger 인자(timezone 제외)로 변환.

    daily/weekly/monthly는 time "HH:MM"을 hour/minute int로 파싱.
    weekly의 days는 mon..sun 순서로 정렬해 콤마 결합."""
    typ = spec["type"]
    if typ == "interval":
        return {
            "hour": f"{spec['start_hour']}-{spec['end_hour']}",
            "minute": f"*/{spec['every_minutes']}",
        }
    hour, minute = (int(p) for p in spec["time"].split(":"))
    if typ == "daily":
        return {"hour": hour, "minute": minute}
    if typ == "weekly":
        days = ",".join(d for d in _DAY_ORDER if d in set(spec["days"]))
        return {"day_of_week": days, "hour": hour, "minute": minute}
    if typ == "monthly":
        return {"day": spec["day_of_month"], "hour": hour, "minute": minute}
    raise ValueError(f"invalid type: {typ!r}")


def describe_schedule(spec: dict) -> str:
    """검증된 spec을 제목 밑에 노출할 한국어 주기설명으로 변환.

    enabled=False면 type/시간과 무관하게 "자동실행 꺼짐".
    포맷은 기존 batch_registry 정적 문자열과 일치(매일/매주/매월/장중)."""
    if not spec.get("enabled"):
        return "자동실행 꺼짐"
    typ = spec["type"]
    if typ == "interval":
        return f"장중 {spec['start_hour']:02d}–{spec['end_hour']:02d}시 {spec['every_minutes']}분마다"
    time = spec["time"]
    if typ == "daily":
        return f"매일 {time}"
    if typ == "weekly":
        days = set(spec["days"])
        labels = ",".join(_DAY_LABELS[d] for d in _DAY_ORDER if d in days)
        return f"매주 {labels} {time}"
    if typ == "monthly":
        return f"매월 {spec['day_of_month']}일 {time}"
    raise ValueError(f"invalid type: {typ!r}")
