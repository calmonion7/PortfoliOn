#!/usr/bin/env python3
"""A/B 측정용 **쓰기 차단 프록시** (task#350).

측정 세션이 프로드에 쓰는 것을 *감지*하는 대신 **구조적으로 불가능하게** 만든다.
「프롬프트로 POST하지 말라고 지시하고 나중에 카운트로 확인」은 절차적 가드라,
모델이 어기면 되돌릴 수 없고(기술 리포트는 slug당 upsert) 확인도 사후다.

    세션 ──→ 127.0.0.1:PORT ──GET/HEAD만──→ prod (진짜 키)
                    └── 그 외 모든 메서드 → 업스트림 미호출. 본문을 캡처하고 성공 응답.

방어는 서로 **독립인 2겹**이고, 한 겹만 재면 나머지가 무력해도 초록이 되므로 따로 검증한다:
  ⓐ 하네스가 프롬프트의 BASE URL을 이 프록시로 치환한다(치환 1건 성립을 단언).
  ⓑ 자식 세션 env의 `PORTFOLION_API_KEY`는 **더미**이고 진짜 키는 이 프록시만 쥔다
     → 세션이 프롬프트를 무시하고 prod를 직접 때려도 401.

부수 이득: 요청 본문이 **있는 그대로** 캡처되므로 모델에게 「out.json에 써 달라」고 부탁할
필요가 없다(부탁은 또 하나의 절차적 가드다).

판정 로직을 `handle_request()` 순수 함수로 분리하고 업스트림 호출자를 주입받게 한 것은
**「업스트림이 호출되지 않았다」를 mock으로 못박기 위해서**다 — 로그에 「차단」이라고 적는 것은
구현이 거짓말할 수 있는 자리라 판정 근거가 될 수 없다(`backend/tests/test_ab_proxy.py`).
"""
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# GET/HEAD만 프로드에 도달한다. 화이트리스트로 쓴다 — 블랙리스트로 쓰면 새 메서드가
# 조용히 통과한다(안전한 방향으로 틀리는 쪽을 고른다).
READ_METHODS = frozenset({"GET", "HEAD"})
UPSTREAM_TIMEOUT = 60


@dataclass
class Context:
    upstream_base: str
    real_key: str
    capture_dir: Path
    log_path: Path


def make_dummy_key() -> str:
    """자식 세션에 줄 가짜 키 — 진짜 키와 절대 충돌하지 않는 길이·접두."""
    return "sk-ab-dummy-" + secrets.token_hex(16)


def _log(ctx: Context, verdict: str, method: str, path: str, extra: str = "") -> None:
    ctx.log_path.parent.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(ctx.log_path, "a") as f:
        f.write(f"[{ts}] {verdict} {method} {path} {extra}\n".rstrip() + "\n")


def _capture(ctx: Context, method: str, path: str, body):
    """쓰기 요청을 파일로 박제한다.

    파일명에 난수를 붙이는 이유 — 같은 경로로 2회 쓰면 앞 캡처를 덮어써서 「세션이 한 번만
    썼다」로 오독된다(fire 리스너가 같은 초 2회 fire로 run.log를 truncate했던 것과 같은 함정,
    task#254).
    """
    ctx.capture_dir.mkdir(parents=True, exist_ok=True)
    slug = path.strip("/").replace("/", "_") or "root"
    name = f"{method}_{slug}_{secrets.token_hex(4)}.json"
    try:
        parsed = json.loads(body.decode()) if body else None
    except Exception:
        # JSON이 아니어도 버리지 않는다 — 원문을 남겨야 왜 이상한지 나중에 읽을 수 있다.
        parsed = {"_raw": body.decode("utf-8", "replace") if body else ""}
    (ctx.capture_dir / name).write_text(
        json.dumps(
            {"method": method, "path": path, "body": parsed, "captured_at": time.time()},
            ensure_ascii=False,
            indent=2,
        )
    )
    return name


def _default_upstream(method: str, path: str, body, headers):
    """진짜 prod 호출 — 읽기 전용 경로에서만 불린다."""
    req = urllib.request.Request(path, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        # 4xx/5xx도 세션에 그대로 전달한다 — 여기서 성공으로 바꾸면 측정이 오염된다.
        return e.code, dict(e.headers or {}), e.read()


def handle_request(method, path, body, headers, ctx: Context, upstream=None):
    """(status, headers, body) 반환. 쓰기면 upstream을 **호출하지 않는다**."""
    upstream = upstream or _default_upstream
    method = method.upper()

    if method not in READ_METHODS:
        name = _capture(ctx, method, path, body)
        _log(ctx, "BLOCK", method, path, f"→ capture/{name}")
        # 세션에 실패로 보이면 재시도 루프를 돌아 측정 자체가 오염된다 → 성공처럼 답한다.
        payload = json.dumps({"ok": True, "shadow": True, "captured": name}).encode()
        return 201, {"Content-Type": "application/json", "Content-Length": str(len(payload))}, payload

    # 읽기: 진짜 키를 **여기서** 붙인다. 자식은 더미만 갖고 있다.
    fwd = {k: v for k, v in (headers or {}).items() if k.lower() not in ("host", "x-api-key")}
    fwd["X-API-Key"] = ctx.real_key
    status, up_headers, up_body = upstream(method, ctx.upstream_base + path, body, fwd)
    _log(ctx, "PASS", method, path, f"→ {status}")
    out = {"Content-Type": up_headers.get("Content-Type", "application/json")}
    out["Content-Length"] = str(len(up_body or b""))
    return status, out, up_body


class _Handler(BaseHTTPRequestHandler):
    ctx = None

    def _dispatch(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None
        status, headers, out = handle_request(
            self.command, self.path, body, dict(self.headers), self.ctx
        )
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if out and self.command != "HEAD":
            self.wfile.write(out)

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = _dispatch

    def log_message(self, fmt, *args):  # 기본 stderr 로그 억제 — proxy.log가 정본
        pass


def serve(ctx: Context, port: int = 0):
    """(server, port) 반환. port=0이면 빈 포트를 커널이 고른다(동시 실행 충돌 방지)."""
    handler = type("H", (_Handler,), {"ctx": ctx})
    srv = HTTPServer(("127.0.0.1", port), handler)
    return srv, srv.server_address[1]


if __name__ == "__main__":
    import threading

    base = os.environ.get("AB_UPSTREAM", "https://portfolion.taebro.com")
    out = Path(os.environ.get("AB_OUT", "./ab-proxy-out"))
    ctx = Context(base, os.environ["AB_REAL_KEY"], out / "capture", out / "proxy.log")
    srv, port = serve(ctx, int(os.environ.get("AB_PORT", "0")))
    print(json.dumps({"port": port, "out": str(out)}), flush=True)
    threading.Thread(target=srv.serve_forever, daemon=False).start()
