#!/usr/bin/env python3
"""fire 리스너 로그 진단성 테스트 (task#346).

왜 이 파일이 필요한가 — 실측 동기:
  `~/Library/Logs/portfolion-cowork-fire.log`에 `POST /fire → 401`이 4건 남아 있는데,
  **로그에 타임스탬프가 없어 그 401이 어느 fire였는지조차 확정할 수 없었다.** 토큰 지문은
  `.env.docker`와 컨테이너 env가 일치했고 8787의 클라이언트는 백엔드뿐이라, 남은 판별 수단이
  시각뿐이었는데 그게 없었다. 이 테스트는 *다음* 401을 즉시 판정 가능하게 만드는 성질을 못박는다.

왜 실제 HTTP를 치는가:
  `Handler.do_POST`를 직접 부르면 `send_response`가 요구하는 소켓 상태를 흉내내야 하고, 그러면
  「로그가 실제로 방출되는가」라는 이 테스트의 판정 대상 자체가 흉내로 바뀐다. 임시 포트(0)로
  진짜 서버를 띄우는 편이 싸고 충실하다.

부작용 차단:
  `_spawn_claude`·`_enqueue_chunks`를 스텁으로 갈아끼운다 — 갈아끼우지 않으면 200 경로가
  **진짜 `claude -p` 세션을 스폰**한다(프로덕션 쓰기). 스텁이 호출됐는지를 ④⑤가 단언하므로
  「전부 거부」로는 통과할 수 없다(양성 축 — 음성만 두면 제약이 없어도 초록이다).
"""
import importlib.util
import io
import json
import re
import sys
import threading
import urllib.error
import urllib.request
from contextlib import redirect_stdout
from http.server import HTTPServer
from pathlib import Path
from typing import Optional  # 로컬 .venv/launchd python은 3.9 — PEP604 `X | None` 금지

LISTENER = Path(__file__).resolve().parent / "cowork-fire-listener.py"
TS_RE = re.compile(r"^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]")

_results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    _results.append((bool(ok), label))
    print(f"  {'✓' if ok else '✗'} {label}")


def load_listener():
    spec = importlib.util.spec_from_file_location("fire_listener_under_test", LISTENER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # `__main__` 가드가 있어 import만으로 서버가 뜨지 않는다
    return mod


def post(port: int, path: str, headers: dict, body: Optional[dict]):
    data = json.dumps(body).encode() if body is not None else b"{}"
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        # ⚠️ `e.read()`를 감싸지 않는다 — 거부 응답에 Content-Length가 없으면 여기서
        # ConnectionResetError가 터지고, 그 예외가 곧 ⑩이 막으려는 결함의 증상이다.
        # try로 삼키면 테스트가 초록이 되면서 결함만 남는다.
        return e.code, e.read().decode(), dict(e.headers)


def main() -> int:
    mod = load_listener()
    token = mod._env_value("COWORK_ROUTINE_FIRE_TOKEN")
    if not token:
        print("✗ 전제 실패: .env.docker에 COWORK_ROUTINE_FIRE_TOKEN이 없다 — 축이 대상에 닿지 못한다")
        return 2

    spawned: list[tuple] = []
    enqueued: list[tuple] = []
    mod._spawn_claude = lambda text, model=mod.DEFAULT_MODEL: (
        spawned.append((text, model)) or "/tmp/stub-run")
    mod._enqueue_chunks = lambda text, tickers, model, chunk: (
        enqueued.append((text, tickers, model, chunk)) or 1)

    srv = HTTPServer(("127.0.0.1", 0), mod.Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            st_noauth, _, h_noauth = post(port, "/fire", {}, {"text": "x"})
            st_bad, _, _ = post(port, "/fire", {"Authorization": "Bearer not-the-real-token"}, {"text": "x"})
            st_ok, body_ok, _ = post(port, "/fire", {"Authorization": f"Bearer {token}"}, {"text": "x"})
            st_bulk, body_bulk, _ = post(
                port, "/fire", {"Authorization": f"Bearer {token}"},
                {"text": "x", "tickers": ["AAPL", "MSFT"], "model": "sonnet", "chunk": 5})
            st_404, _, h_404 = post(port, "/nope", {"Authorization": f"Bearer {token}"}, {})
    finally:
        srv.shutdown()
        srv.server_close()

    log = buf.getvalue()
    lines = [ln for ln in log.splitlines() if ln.strip()]
    print(log, end="")
    print("--- 단언 ---")

    # ① 토큰 부재 — Authorization 헤더가 아예 없는 경우
    check(st_noauth == 401 and "no-auth-header" in log,
          f"① 헤더 부재 → 401 + 마커 no-auth-header (status={st_noauth})")
    # ② 토큰 불일치 — 헤더는 있는데 값이 다른 경우
    check(st_bad == 401 and "token-mismatch" in log,
          f"② 토큰 불일치 → 401 + 마커 token-mismatch (status={st_bad})")
    # ③ 두 사유가 **같은 마커**로 뭉개지면 401을 봐도 여전히 원인을 모른다 — 구분이 목적이다
    check("no-auth-header" in log and "token-mismatch" in log,
          "③ 401 사유 2종이 서로 다른 마커로 구분된다")
    # ④ 양성 축 — 이게 없으면 「모든 요청을 거부」해도 ①②가 통과한다
    check(st_ok == 200 and len(spawned) == 1,
          f"④ 정상 토큰 단일 fire → 200 + 스폰 1회 (status={st_ok}, spawned={len(spawned)})")
    # ⑤ 기존 전량 계약 무회귀 — 응답 키 `chunks`까지 본다(200만 보면 계약이 바뀌어도 통과)
    ok_bulk = st_bulk == 200 and len(enqueued) == 1 and "chunks" in json.loads(body_bulk or "{}")
    check(ok_bulk, f"⑤ tickers fire → 200 + 큐잉 1회 + chunks 키 (status={st_bulk})")
    # ⑥ 이 작업의 본체 — 시각 없는 로그는 상관을 못 짓는다
    bad_ts = [ln for ln in lines if not TS_RE.match(ln)]
    check(not bad_ts,
          f"⑥ 모든 로그 라인이 [YYYY-MM-DD HH:MM:SS]로 시작 (위반 {len(bad_ts)}건"
          + (f", 예: {bad_ts[0][:60]!r}" if bad_ts else "") + ")")
    # ⑦ 시크릿 유출 가드 — 401을 디버깅하려고 헤더 값을 찍고 싶어지는 자리다
    check(token not in log, "⑦ 로그에 실제 토큰 값이 등장하지 않는다")
    # ⑧ 잘못된 경로도 같은 규율을 받는다(404 경로만 옛 print로 남는 것을 막는다)
    ts_404 = any(TS_RE.match(ln) and "404" in ln for ln in lines)
    check(st_404 == 404 and ts_404, f"⑧ /nope → 404 + 타임스탬프 로그 (status={st_404})")
    # ⑨ ⑦의 **이빨** — ⑦은 red-first가 없다(수정 전에도 통과했다). 그래서 「제약이 작동해서
    #    통과」와 「판정식이 아무것도 못 보아서 통과」가 구별되지 않는다. 리스너에 토큰을 실제로
    #    찍어 확인하는 것은 평문 시크릿을 로그에 남기므로(그 시도는 크리덴셜 차단에 정당하게
    #    막혔다) 대신 판정식만 sentinel로 검사한다 — 로그에 토큰이 *있었다면* ⑦이 잡는가.
    #    ⑦이 공허해지는 실제 경로는 「로그가 비어서 자명히 통과」다 — 리다이렉트가 빗나가거나
    #    방출이 stderr로 새면 log가 ''이 되고, 그러면 ⑦뿐 아니라 ⑥까지 무료로 통과한다.
    #    그러니 재야 할 것은 「판정식이 참인가」가 아니라 **「판정 대상이 존재하는가」**다.
    check(len(lines) >= 5, f"⑨ 커버리지 sentinel — 로그가 요청 5건분 이상을 담는다 (실측 {len(lines)}줄)")
    # ⑩ 거부 응답이 HTTP상 완결인가. 없으면 호출측이 상태코드 대신 ConnectionReset을 받아
    #    **「401을 받았다」는 사실 자체가 상대 로그에서 사라진다**(6회 중 2회 재현한 간헐 결함을
    #    결정적 축으로 바꾼 것). 진단성이 목적이므로 이 축은 그 목적에 직결된다.
    check("Content-Length" in h_noauth and "Content-Length" in h_404,
          "⑩ 401·404 거부 응답에 Content-Length 헤더가 있다(간헐 ConnectionReset 방지)")

    passed = sum(1 for ok, _ in _results if ok)
    print(f"단언 총계: {len(_results)} · 통과 {passed} · 실패 {len(_results) - passed}")
    return 0 if passed == len(_results) else 1


if __name__ == "__main__":
    sys.exit(main())
