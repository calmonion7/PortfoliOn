"""API 문서 ↔ 라이브 라우터 drift 자동검출 (task#99).

엔드포인트(method+path) *존재* drift만 검출 — 스키마/인증 게이팅은 수동 DoD.
라이브 ground-truth는 `main.app`의 `app.routes`(데코레이터 파싱 아님), 두 문서의
canonical 정의는 `### `METHOD /path`` 헤더(동일 포맷).
"""
import re
from pathlib import Path

from main import app

_ROOT = Path(__file__).resolve().parents[2]

# FastAPI 기본 util 경로(문서화 대상 아님). /health는 문서화돼 있어 포함.
_EXCLUDE_PATHS = {"/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}
_METHODS = {"GET", "POST", "PUT", "DELETE", "PATCH"}
_HEADER_RE = re.compile(r"#+\s+`(GET|POST|PUT|DELETE|PATCH)\s+(\S+)`")


def _norm(path: str) -> str:
    """path param `{ticker}`→`{}`(철자 차이 무시), 쿼리스트링·끝 슬래시 제거."""
    path = path.split("?")[0].strip("`").rstrip("/")
    return re.sub(r"\{[^}]+\}", "{}", path)


def _live() -> set:
    out = set()
    for r in app.routes:
        if getattr(r, "path", None) in _EXCLUDE_PATHS:
            continue
        for m in getattr(r, "methods", None) or []:
            if m in _METHODS:
                out.add((m, _norm(r.path)))
    return out


def _doc_endpoints(filename: str) -> set:
    out = set()
    for line in (_ROOT / filename).read_text(encoding="utf-8").splitlines():
        mm = _HEADER_RE.match(line)
        if mm:
            out.add((mm.group(1), _norm(mm.group(2))))
    return out


# 미문서화 라이브 엔드포인트의 동결 베이스라인. task#100에서 23개 전수 문서화 완료 → 0.
# exact-match로 단언하므로 새 엔드포인트를 문서 없이 추가하면 집합이 커져 즉시 실패(drift 포착).
# 미문서 엔드포인트가 생기면(의도적 유예) 여기 추가, 문서화하면 제거(self-maintaining).
KNOWN_UNDOCUMENTED = frozenset()


def test_api_spec_documents_all_live_endpoints():
    """라이브 − API_SPEC == KNOWN_UNDOCUMENTED (정확히)."""
    undocumented = _live() - _doc_endpoints("API_SPEC.md")
    new_drift = undocumented - KNOWN_UNDOCUMENTED
    stale_allowlist = KNOWN_UNDOCUMENTED - undocumented
    assert not new_drift, (
        f"라이브에 있으나 API_SPEC.md 미문서화(새 drift) — 문서화하거나 의도적이면 "
        f"KNOWN_UNDOCUMENTED에 추가: {sorted(new_drift)}")
    assert not stale_allowlist, (
        f"이미 문서화됐으니 KNOWN_UNDOCUMENTED에서 제거 필요(또는 라우터에서 사라짐): "
        f"{sorted(stale_allowlist)}")


def test_api_spec_has_no_stale_endpoints():
    """API_SPEC.md가 라이브에 없는(삭제된) 엔드포인트를 문서화하지 않는다."""
    stale = _doc_endpoints("API_SPEC.md") - _live()
    assert not stale, f"API_SPEC.md가 라이브에 없는 엔드포인트 문서화(삭제 누락): {sorted(stale)}"


def test_cowork_api_has_no_stale_endpoints():
    """CLAUDE_COWORK_API.md(부분집합)가 라이브에 없는 엔드포인트를 문서화하지 않는다."""
    stale = _doc_endpoints("CLAUDE_COWORK_API.md") - _live()
    assert not stale, f"CLAUDE_COWORK_API.md가 라이브에 없는 엔드포인트 문서화: {sorted(stale)}"
