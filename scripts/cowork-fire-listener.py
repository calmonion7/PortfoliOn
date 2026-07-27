#!/usr/bin/env python3
"""PortfoliOn 로컬 fire 리스너 (ADR-0028 개정판) — 배치 완료 fire를 받아 headless claude -p 실행.

- POST /fire  헤더 Authorization: Bearer <COWORK_ROUTINE_FIRE_TOKEN>  body {"text": "..."}
- 127.0.0.1:8787 바인드 (백엔드 컨테이너는 host.docker.internal:8787로 도달)
- 프롬프트 = scripts/cowork-routine-prompt.md ({{COWORK_API_KEY}}는 .env.docker 값으로 치환) + 트리거 text
- claude -p는 빈 스크래치 디렉터리에서 실행(레포 컨텍스트/편집 차단), 출력은 런별 로그 파일
- launchd 서비스: com.portfolion.cowork-fire-listener (HOME/USER/LOGNAME 필수 — keychain footgun)

eco: 동시 fire는 그대로 병행 스폰(중복 enrich 가능하나 무해) — 큐잉은 필요해지면.
"""
import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROMPT_FILE = REPO / "scripts" / "cowork-routine-prompt.md"
ENV_FILE = REPO / "backend" / ".env.docker"
RUN_DIR = Path.home() / "portfolion-routine-runs"
PORT = 8787


def _env_value(key: str) -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return ""


def _spawn_claude(text: str) -> str:
    api_key = _env_value("COWORK_API_KEY")
    prompt = PROMPT_FILE.read_text().replace("{{COWORK_API_KEY}}", api_key)
    if text:
        prompt += f"\n\n[트리거 지시]\n{text}\n"
    ts = time.strftime("%Y%m%d-%H%M%S")
    workdir = RUN_DIR / ts
    workdir.mkdir(parents=True, exist_ok=True)
    log = open(workdir / "run.log", "w")
    subprocess.Popen(
        ["claude", "-p", prompt, "--model", "opus",
         "--allowedTools", "Bash,WebSearch,WebFetch,Read,Write"],
        cwd=workdir, stdout=log, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, start_new_session=True,
    )
    return str(workdir)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/fire":
            self.send_response(404); self.end_headers(); return
        token = _env_value("COWORK_ROUTINE_FIRE_TOKEN")
        auth = self.headers.get("Authorization", "")
        if not token or auth != f"Bearer {token}":
            self.send_response(401); self.end_headers(); return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            text = str(body.get("text", ""))[:4000]
        except Exception:
            text = ""
        try:
            workdir = _spawn_claude(text)
            out = json.dumps({"ok": True, "run": workdir}).encode()
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
