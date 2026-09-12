#!/usr/bin/env python3
"""PortfoliOn 로컬 fire 리스너 (ADR-0028 개정판) — 배치 완료 fire를 받아 headless claude -p 실행.

- POST /fire  헤더 Authorization: Bearer <COWORK_ROUTINE_FIRE_TOKEN>
    body {"text": "..."}                       → 즉시 1세션 논블로킹 스폰(기존 계약)
    body {"text":..., "tickers":[...],          → 전량 모드: chunk개씩 잘라 **순차** 스폰
          "model":"sonnet", "chunk":5}             (task#344 — 한 세션에 전 종목을 맡기면 죽는다)
- 127.0.0.1:8787 바인드 (백엔드 컨테이너는 host.docker.internal:8787로 도달)
- 프롬프트 = scripts/cowork-routine-prompt.md ({{COWORK_API_KEY}}는 .env.docker 값으로 치환) + 트리거 text
  → argv가 아니라 **stdin**으로 넘긴다(ps에 API 키가 보이지 않게). claude -p는 positional
  prompt가 없으면 stdin에서 읽는다.
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
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROMPT_FILE = REPO / "scripts" / "cowork-routine-prompt.md"
ENV_FILE = REPO / "backend" / ".env.docker"
RUN_DIR = Path.home() / "portfolion-routine-runs"
PORT = 8787
DEFAULT_MODEL = "opus"
DEFAULT_CHUNK = 5
# 한도 소진은 세션이 즉시 죽으면서 로그 첫 줄에만 남는다 — 남은 청크를 계속 띄우면
# 같은 실패를 K번 반복해 로그만 늘린다.
_LIMIT_MARKERS = ("hit your weekly limit", "usage limit", "limit reached")
# 한도 문구가 첫 줄에 온다는 보장이 없다(배너·MCP 로딩 로그가 앞설 수 있다) → 앞부분을 읽는다.
_LOG_HEAD_BYTES = 4096
# 세션 하나가 영영 안 끝나면 **워커 스레드가 영구 정지**하고(그 스레드는 is_alive()가 True라
# 재기동 로직도 못 구한다) 이후 모든 전량 회차가 큐에 쌓이기만 한다. 5종목 1청크의 실측은
# ~19분이므로 3배 여유를 둔다.
_CHUNK_TIMEOUT = 3600
_MAX_CHUNK = 50


def _env_value(key: str) -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return ""


def _spawn_proc(text, model=DEFAULT_MODEL, tickers=None):
    """세션 하나를 띄우고 (proc, workdir)을 돌려준다. 호출측이 wait 여부를 정한다."""
    api_key = _env_value("COWORK_API_KEY")
    prompt = PROMPT_FILE.read_text().replace("{{COWORK_API_KEY}}", api_key)
    if text:
        prompt += f"\n\n[트리거 지시]\n{text}\n"
    if tickers:
        prompt += "\n[대상 종목]\n" + "\n".join(tickers) + "\n"
    ts = time.strftime("%Y%m%d-%H%M%S")
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix=ts + "-", dir=str(RUN_DIR)))
    log = open(workdir / "run.log", "w")
    proc = subprocess.Popen(
        ["claude", "-p", "--model", model,
         "--allowedTools", "Bash,WebSearch,WebFetch,Read,Write"],
        cwd=workdir, stdout=log, stderr=subprocess.STDOUT,
        stdin=subprocess.PIPE, start_new_session=True,
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
            print(f"[fire-listener] 청크 {i + 1}/{len(groups)} 타임아웃({_CHUNK_TIMEOUT}s) — 강제 종료",
                  flush=True)
        if _hit_limit(workdir):
            print(f"[fire-listener] 한도로 중단, 잔여 {len(groups) - i - 1}청크", flush=True)
            return
        # rc를 안 보면 인증 오류·바이너리 부재 같은 **한도 아닌 모든 실패**가 「완료」로 찍힌다
        # (계측 실패를 판정 성공으로 읽는 것). 한 청크 실패로 나머지를 버리지는 않는다.
        if rc == 0:
            print(f"[fire-listener] 청크 {i + 1}/{len(groups)} 완료 ({len(group)}종목)", flush=True)
        elif rc is not None:
            print(f"[fire-listener] 청크 {i + 1}/{len(groups)} 실패 (exit {rc}, {len(group)}종목) — 계속",
                  flush=True)


_QUEUE: "queue.Queue" = queue.Queue()
_WORKER_LOCK = threading.Lock()
_WORKER = None


def _worker_loop():
    while True:
        job = _QUEUE.get()
        try:
            _run_chunks(*job)
        except Exception as e:  # 한 회차의 실패가 워커를 죽이면 이후 전량 fire가 영영 안 돈다
            print(f"[fire-listener] 전량 회차 실패: {e}", flush=True)
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
    def do_POST(self):
        if self.path != "/fire":
            self.send_response(404); self.end_headers(); return
        token = _env_value("COWORK_ROUTINE_FIRE_TOKEN")
        auth = self.headers.get("Authorization", "")
        if not token or auth != f"Bearer {token}":
            self.send_response(401); self.end_headers(); return
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
        print(f"[fire-listener] {self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    RUN_DIR.mkdir(exist_ok=True)
    print(f"[fire-listener] listening on 127.0.0.1:{PORT}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
