#!/usr/bin/env python3
"""PortfoliOn 로컬 fire 리스너 (ADR-0028 개정판) — 배치 완료 fire를 받아 세션을 스폰한다.

실행기는 `model`로 갈린다(task#348) — `/` 포함 model(예: `opencode/muse-spark-1.3-contributor-free`)은
`opencode run -m <model> --auto`, 아니면 기존 `claude -p --model <model>`(무회귀, 바이트 동일).

- POST /fire  헤더 Authorization: Bearer <COWORK_ROUTINE_FIRE_TOKEN>
    body {"text": "..."}                       → 즉시 1세션 논블로킹 스폰(기존 계약)
    body {"text":..., "tickers":[...],          → 전량 모드: chunk개씩 잘라 **순차** 스폰
          "model":"sonnet", "chunk":5}             (task#344 — 한 세션에 전 종목을 맡기면 죽는다)
- 127.0.0.1:8787 바인드 (백엔드 컨테이너는 host.docker.internal:8787로 도달)
- 프롬프트 = scripts/cowork-routine-prompt.md + 트리거 text → argv가 아니라 **stdin**으로 넘긴다
  (ps 노출 차단). claude -p는 positional prompt가 없으면 stdin에서 읽는다.
- API 키는 프롬프트에 **싣지 않고** 자식 env `PORTFOLION_API_KEY`로 주입한다(task#349).
  프롬프트는 `$PORTFOLION_API_KEY`만 참조한다 — OpenCode `run`이 bash 명령을 run.log에
  에코하므로 프롬프트에 값이 있으면 그 값이 평문 로그로 샌다. run.log는 0600으로 생성.
- claude -p는 빈 스크래치 디렉터리에서 실행(레포 컨텍스트/편집 차단), 출력은 런별 로그 파일
  → workdir은 mkdtemp로 **원자 생성**한다. 리스너는 launchd 장수 단일 프로세스라 PID가 늘
  같아서, 초 단위 ts만으로는 같은 초 2회 fire가 cwd를 공유해 앞 run의 run.log를 truncate했다.
- launchd 서비스: com.portfolion.cowork-fire-listener (HOME/USER/LOGNAME 필수 — keychain footgun)

eco: `tickers` 없는 fire는 그대로 병행 스폰(중복 enrich 가능하나 무해). 전량 모드만 단일
워커 스레드의 큐를 타므로 동시 세션이 0이고, 큐가 도는 중 들어온 전량 fire는 뒤에 붙는다.
"""
import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
PROMPT_FILE = REPO / "scripts" / "cowork-routine-prompt.md"
ENV_FILE = REPO / "backend" / ".env.docker"
RUN_DIR = Path.home() / "portfolion-routine-runs"
PORT = 8787
DEFAULT_MODEL = "opus"
DEFAULT_CHUNK = 5
# 한도 소진은 세션이 즉시 죽으면서 로그 첫 줄에만 남는다 — 남은 청크를 계속 띄우면
# 같은 실패를 K번 반복해 로그만 늘린다.
_LIMIT_MARKERS = ("hit your weekly limit", "usage limit", "limit reached", "no payment method")
# 한도 문구가 첫 줄에 온다는 보장이 없다(배너·MCP 로딩 로그가 앞설 수 있다) → 앞부분을 읽는다.
_LOG_HEAD_BYTES = 4096
# 세션 하나가 영영 안 끝나면 **워커 스레드가 영구 정지**하고(그 스레드는 is_alive()가 True라
# 재기동 로직도 못 구한다) 이후 모든 전량 회차가 큐에 쌓이기만 한다. 5종목 1청크의 실측은
# ~19분이므로 3배 여유를 둔다.
_CHUNK_TIMEOUT = 3600
_MAX_CHUNK = 50


def _log(msg: str) -> None:
    """리스너의 **유일한** 로그 방출 지점 — 시각 없는 로그는 상관을 못 짓는다(task#346).

    실측 동기: `POST /fire → 401` 4건이 남았는데 타임스탬프가 없어 그 401이 어느 fire였는지
    확정할 수 없었다. 토큰 지문 대조·클라이언트 식별로도 좁혀지지 않아 남은 수단이 시각뿐이었다.
    새 방출 지점을 만들 때 `print`를 쓰지 말 것 — 그 한 줄만 시각을 잃는다.
    """
    try:
        ts = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:  # tzdata 부재 등 — 로그가 리스너를 죽이지는 않게 한다
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [fire-listener] {msg}", flush=True)


def _env_value(key: str) -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return ""


def _runner_argv(model: str) -> list:
    """model로 실행기를 가른다 — `/` 포함이면 OpenCode, 아니면 기존 claude -p.

    `/` 없는 분기는 기존 argv와 **바이트 동일**이어야 한다(무회귀 이빨,
    `test_runner_argv_claude_unchanged`).
    """
    if "/" in model:
        opencode = shutil.which("opencode") or "/opt/homebrew/bin/opencode"
        return [opencode, "run", "-m", model, "--auto"]
    return ["claude", "-p", "--model", model,
            "--allowedTools", "Bash,WebSearch,WebFetch,Read,Write"]


def _spawn_proc(text, model=DEFAULT_MODEL, tickers=None):
    """세션 하나를 띄우고 (proc, workdir)을 돌려준다. 호출측이 wait 여부를 정한다."""
    api_key = _env_value("COWORK_API_KEY")
    # 키 **값**은 프롬프트에 싣지 않는다 — env로만 자식에게 준다(task#349).
    # OpenCode `run`은 실행한 bash 명령을 stdout에 에코하고 그것이 run.log에 남으므로,
    # 프롬프트에 값이 있으면 그 값이 평문 로그가 된다(task#348 실측: 26청크 전부).
    # 옛 자리표시자는 지우는 게 아니라 **변수 참조로** 바꾼다 — 그냥 지우면 세션이
    # literal `{{COWORK_API_KEY}}`를 헤더로 보내 401이 된다(하위호환).
    prompt = PROMPT_FILE.read_text().replace("{{COWORK_API_KEY}}", "$PORTFOLION_API_KEY")
    if text:
        prompt += f"\n\n[트리거 지시]\n{text}\n"
    if tickers:
        prompt += "\n[대상 종목]\n" + "\n".join(tickers) + "\n"
    ts = time.strftime("%Y%m%d-%H%M%S")
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix=ts + "-", dir=str(RUN_DIR)))
    # 0600으로 **생성 시점에** 연다 — `open()` 후 chmod는 그 사이 창에서 0644로 읽힌다.
    log = os.fdopen(
        os.open(workdir / "run.log", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w"
    )
    proc = subprocess.Popen(
        _runner_argv(model),
        cwd=workdir, stdout=log, stderr=subprocess.STDOUT,
        stdin=subprocess.PIPE, start_new_session=True,
        # 부모 환경 **위에** 얹는다 — 통째로 갈아끼우면 PATH가 사라져 실행기가 안 뜬다.
        env={**os.environ, "PORTFOLION_API_KEY": api_key},
    )
    # 프롬프트 ~33KB < 파이프 버퍼 64KB → 논블로킹(claude를 기다리지 않는다).
    # ⚠️ 이 주석이 코드 경로를 가두고 있다 — 프롬프트가 커져 64KB를 넘으면 이 write가
    # 블로킹돼 기존 경로의 fire 응답이 세션 내내 막힌다(전량 모드는 어차피 wait하므로 무해).
    # 「~8KB」로 적혀 있었으나 실측 33KB이고, 남은 여유는 2배다.
    proc.stdin.write(prompt.encode())
    proc.stdin.close()
    return proc, workdir


def _spawn_claude(text: str, model: str = DEFAULT_MODEL) -> str:
    """기존 계약 — 논블로킹 스폰 후 workdir 문자열을 즉시 반환한다."""
    _, workdir = _spawn_proc(text, model)
    return str(workdir)


def _hit_limit(workdir) -> bool:
    """세션이 한도로 즉사했는가.

    첫 줄만 보면 배너·로딩 로그가 앞설 때 한도를 놓친다 — 앞 _LOG_HEAD_BYTES를 본다.
    반대로 전문을 훑으면 정상 세션의 도구 출력에 섞인 문구를 오탐해 잔여 청크를 통째로
    버리므로, 「즉사한 세션의 로그는 짧다」는 성질에 기대 범위를 유계로 둔다.
    """
    try:
        with open(workdir / "run.log") as f:
            head = f.read(_LOG_HEAD_BYTES).lower()
    except Exception:
        return False
    return any(m in head for m in _LIMIT_MARKERS)


def _run_chunks(text: str, tickers: list, model: str, chunk: int) -> None:
    """청크를 **순차** 실행한다 — 앞 세션이 끝나야 다음이 뜬다(동시 세션 0)."""
    groups = [tickers[i:i + chunk] for i in range(0, len(tickers), chunk)]
    for i, group in enumerate(groups):
        proc, workdir = _spawn_proc(text, model, group)
        try:
            rc = proc.wait(timeout=_CHUNK_TIMEOUT)
        except subprocess.TimeoutExpired:
            # 무한 대기는 워커를 영구 정지시킨다 — 이 청크를 포기하고 다음으로 간다.
            proc.kill()
            rc = None
            _log(f"청크 {i + 1}/{len(groups)} 타임아웃({_CHUNK_TIMEOUT}s) — 강제 종료")
        if _hit_limit(workdir):
            _log(f"한도로 중단, 잔여 {len(groups) - i - 1}청크")
            return
        # rc를 안 보면 인증 오류·바이너리 부재 같은 **한도 아닌 모든 실패**가 「완료」로 찍힌다
        # (계측 실패를 판정 성공으로 읽는 것). 한 청크 실패로 나머지를 버리지는 않는다.
        if rc == 0:
            _log(f"청크 {i + 1}/{len(groups)} 완료 ({len(group)}종목)")
        elif rc is not None:
            _log(f"청크 {i + 1}/{len(groups)} 실패 (exit {rc}, {len(group)}종목) — 계속")


_QUEUE: "queue.Queue" = queue.Queue()
_WORKER_LOCK = threading.Lock()
_WORKER = None


def _worker_loop():
    while True:
        job = _QUEUE.get()
        try:
            _run_chunks(*job)
        except Exception as e:  # 한 회차의 실패가 워커를 죽이면 이후 전량 fire가 영영 안 돈다
            _log(f"전량 회차 실패: {e}")
        finally:
            _QUEUE.task_done()


def _enqueue_chunks(text: str, tickers: list, model: str, chunk: int) -> int:
    """전량 회차를 큐에 넣고 청크 수를 돌려준다(워커는 최초 1회만 뜬다)."""
    global _WORKER
    with _WORKER_LOCK:
        if _WORKER is None or not _WORKER.is_alive():
            _WORKER = threading.Thread(target=_worker_loop, daemon=True)
            _WORKER.start()
    _QUEUE.put((text, tickers, model, chunk))
    return (len(tickers) + chunk - 1) // chunk


class Handler(BaseHTTPRequestHandler):
    def _reject(self, code: int) -> None:
        """바디 없는 거부 응답 — `Content-Length: 0`이 **없으면 간헐 ConnectionReset**이 난다.

        옛 코드는 `send_response(code); end_headers()`만 했다. 길이도 `Connection: close`도 없으니
        클라이언트가 바디를 읽으려 할 때 서버가 이미 연결을 닫아 버려, 호출측이 상태코드 대신
        소켓 예외를 받는다(이 테스트에서 6회 중 2회 재현). 즉 **401을 받은 쪽 로그가 「401」이
        아니라 「연결 끊김」으로 남을 수 있었다** — 진단성이 목적인 이 작업에서 그대로 둘 수 없다.
        상태코드도 응답 바디 키도 바뀌지 않으므로 백엔드 `cowork_trigger.fire` 계약은 그대로다.
        """
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self.path != "/fire":
            self._reject(404); return
        token = _env_value("COWORK_ROUTINE_FIRE_TOKEN")
        auth = self.headers.get("Authorization", "")
        # 사유 3종을 가른다 — 옛 코드는 `not token or auth != ...` 로 뭉개서, 401을 봐도 서버
        # 설정 문제인지 클라이언트 문제인지 알 수 없었다(실측 401 4건이 그래서 미해결로 남았다).
        # ⚠️ 토큰 값도 Authorization 헤더 값도 로그에 싣지 말 것 — 디버깅용으로 찍고 싶어지는
        # 자리이고, 그 로그 파일은 평문으로 오래 남는다(테스트 ⑦이 이 가드다).
        reason = None
        if not token:
            reason = "no-server-token — .env.docker에 COWORK_ROUTINE_FIRE_TOKEN이 없다(서버 설정)"
        elif not auth:
            reason = "no-auth-header — 요청에 Authorization 헤더가 없다(클라이언트)"
        elif auth != f"Bearer {token}":
            reason = "token-mismatch — 헤더 토큰이 .env.docker 값과 다르다(백엔드 컨테이너 env가 stale한가?)"
        if reason:
            _log(f"401 {reason}")
            self._reject(401); return
        text, tickers, model, chunk = "", None, DEFAULT_MODEL, DEFAULT_CHUNK
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            body = {}
        # ⚠️ 필드별로 폴백한다 — 하나를 통째 try로 묶으면 `chunk` 파싱 실패가 `tickers`까지
        # 버려서 **전량 모드가 조용히 단일 opus 세션으로 다운그레이드**된다(fail-open).
        try:
            text = str(body.get("text", ""))[:4000]
        except Exception:
            pass
        raw = body.get("tickers")
        if isinstance(raw, list):
            tickers = [str(t) for t in raw]
        try:
            model = str(body.get("model") or DEFAULT_MODEL)
        except Exception:
            pass
        try:
            # 상한이 없으면 ADR이 명시적으로 버린 「단일 세션 전량」으로 퇴행한다.
            chunk = min(_MAX_CHUNK, max(1, int(body.get("chunk") or DEFAULT_CHUNK)))
        except Exception:
            pass
        try:
            if tickers:
                chunks = _enqueue_chunks(text, tickers, model, chunk)
                out = json.dumps({"ok": True, "run": "queued", "chunks": chunks}).encode()
            else:
                out = json.dumps({"ok": True, "run": _spawn_claude(text, model)}).encode()
            self.send_response(200)
        except Exception as e:
            out = json.dumps({"ok": False, "error": str(e)}).encode()
            self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, fmt, *args):  # 기본 stderr 로그 → launchd 로그 파일로 수집됨
        _log(f"{self.address_string()} {fmt % args}")


if __name__ == "__main__":
    RUN_DIR.mkdir(exist_ok=True)
    _log(f"listening on 127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
