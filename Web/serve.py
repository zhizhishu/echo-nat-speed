#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = WEB_ROOT.parent
DEFAULT_HOST = os.getenv("ECHO_NAT_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.getenv("ECHO_NAT_PORT", "8080"))
INETSPEED_REPO_URL = "https://github.com/nxtrace/iNetSpeed-CLI"


def candidate_repo_paths() -> list[Path]:
    candidates: list[Path] = []
    env_repo = os.getenv("INETSPEED_CLI_REPO", "").strip()
    if env_repo:
        candidates.append(Path(env_repo).expanduser())
    candidates.extend(
        [
            PROJECT_ROOT / "vendor" / "iNetSpeed-CLI",
            PROJECT_ROOT / "iNetSpeed-CLI",
            Path("/tmp/iNetSpeed-CLI"),
        ]
    )
    return candidates


def resolve_cli_command() -> tuple[list[str], Path | None, dict[str, str]]:
    custom_cmd = os.getenv("INETSPEED_CLI_CMD", "").strip()
    if custom_cmd:
        return shlex.split(custom_cmd), None, {"mode": "command", "source": "INETSPEED_CLI_CMD"}

    for executable in ("speedtest", "inetspeed"):
        resolved = shutil.which(executable)
        if resolved:
            return [resolved], None, {"mode": "binary", "source": resolved}

    for repo_path in candidate_repo_paths():
        if (repo_path / "cmd" / "speedtest" / "main.go").exists():
            return ["go", "run", "./cmd/speedtest"], repo_path, {"mode": "repo", "source": str(repo_path)}

    raise FileNotFoundError(
        "未找到 iNetSpeed-CLI。请先安装 speedtest/inetspeed 到 PATH，"
        "或设置 INETSPEED_CLI_CMD / INETSPEED_CLI_REPO。"
    )


def build_speedtest_args(payload: dict[str, object]) -> list[str]:
    args = [
        "--json",
        "--non-interactive",
        "--lang",
        "zh",
        "--timeout",
        str(payload.get("timeout", os.getenv("INETSPEED_TIMEOUT", "4"))),
        "--max",
        str(payload.get("max", os.getenv("INETSPEED_MAX", "4M"))),
        "--latency-count",
        str(payload.get("latency_count", os.getenv("INETSPEED_LATENCY_COUNT", "4"))),
        "--threads",
        str(payload.get("threads", os.getenv("INETSPEED_THREADS", "2"))),
    ]

    endpoint = str(payload.get("endpoint", "")).strip()
    if endpoint:
        args.extend(["--endpoint", endpoint])

    if payload.get("no_metadata", True):
        args.append("--no-metadata")

    return args


def summarize_round(round_data: dict[str, object] | None) -> dict[str, object]:
    if not isinstance(round_data, dict):
        return {
            "name": None,
            "status": "unavailable",
            "mbps": None,
            "durationMs": None,
            "totalBytes": None,
            "faultCount": 0,
            "loadedLatency": {},
        }

    return {
        "name": round_data.get("name"),
        "status": round_data.get("status"),
        "mbps": round_data.get("mbps"),
        "durationMs": round_data.get("duration_ms"),
        "totalBytes": round_data.get("total_bytes"),
        "faultCount": round_data.get("fault_count", 0),
        "loadedLatency": round_data.get("loaded_latency") or {},
    }


def summarize_result(result: dict[str, object], command: list[str], source: dict[str, str]) -> dict[str, object]:
    rounds = result.get("rounds") or []
    if not isinstance(rounds, list):
        rounds = []

    download_rounds = [item for item in rounds if isinstance(item, dict) and item.get("direction") == "download"]
    upload_rounds = [item for item in rounds if isinstance(item, dict) and item.get("direction") == "upload"]
    best_download = max(download_rounds, key=lambda item: float(item.get("mbps") or 0), default=None)
    best_upload = max(upload_rounds, key=lambda item: float(item.get("mbps") or 0), default=None)

    endpoint = result.get("selected_endpoint") or {}
    if not isinstance(endpoint, dict):
        endpoint = {}
    latency = result.get("idle_latency") or {}
    if not isinstance(latency, dict):
        latency = {}

    return {
        "degraded": bool(result.get("degraded")),
        "exitCode": result.get("exit_code"),
        "durationMs": result.get("duration_ms"),
        "totalBytes": result.get("total_bytes"),
        "command": command,
        "commandSource": source.get("source"),
        "endpoint": {
            "ip": endpoint.get("ip"),
            "description": endpoint.get("description"),
            "rttMs": endpoint.get("rtt_ms"),
            "source": endpoint.get("source"),
            "status": endpoint.get("status"),
        },
        "latency": {
            "status": latency.get("status"),
            "samples": latency.get("samples"),
            "medianMs": latency.get("median_ms"),
            "avgMs": latency.get("avg_ms"),
            "jitterMs": latency.get("jitter_ms"),
            "minMs": latency.get("min_ms"),
            "maxMs": latency.get("max_ms"),
        },
        "download": summarize_round(best_download),
        "upload": summarize_round(best_upload),
        "warnings": result.get("warnings") or [],
        "config": result.get("config") or {},
    }


def run_domestic_speed(payload: dict[str, object]) -> dict[str, object]:
    base_cmd, cwd, source = resolve_cli_command()
    cmd = [*base_cmd, *build_speedtest_args(payload)]
    env = os.environ.copy()
    if source["mode"] == "repo":
        env.setdefault("GOTOOLCHAIN", "auto")

    completed = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        capture_output=True,
        text=True,
        timeout=240,
    )

    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    try:
        data = json.loads(stdout) if stdout else None
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"iNetSpeed-CLI 返回了无法解析的 JSON: {exc}") from exc
    if not isinstance(data, dict):
        detail = stderr or stdout or "iNetSpeed-CLI 未返回可解析的 JSON。"
        raise RuntimeError(detail)

    result_exit_code = int(data.get("exit_code", completed.returncode))

    data["bridge"] = {
        "command_source": source["source"],
        "command_exit_code": completed.returncode,
        "command": cmd,
    }
    if stderr:
        data["bridge"]["stderr"] = stderr
    return {
        "ok": result_exit_code in (0, 2),
        "summary": summarize_result(data, cmd, source),
        "raw": data,
        "stderr": stderr,
    }


class EchoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[EchoNAT] " + (fmt % args) + "\n")

    def send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/health":
            try:
                command, cwd, source = resolve_cli_command()
                self.send_json(
                    {
                        "ok": True,
                        "speedtestReady": True,
                        "bridge": "python",
                        "command": command,
                        "workingDirectory": str(cwd) if cwd else None,
                        "commandSource": source.get("source"),
                    }
                )
            except FileNotFoundError as exc:
                self.send_json(
                    {
                        "ok": True,
                        "speedtestReady": False,
                        "bridge": "python",
                        "error": str(exc),
                    }
                )
            return

        super().do_GET()

    def do_POST(self) -> None:
        if self.path not in ("/api/domestic-speed", "/api/domestic-speedtest"):
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length) if length > 0 else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("payload must be an object")
        except Exception:
            self.send_json({"ok": False, "error": "请求体必须是 JSON 对象。"}, HTTPStatus.BAD_REQUEST)
            return

        try:
            result = run_domestic_speed(payload)
        except FileNotFoundError as exc:
            self.send_json(
                {
                    "ok": False,
                    "error": str(exc),
                    "repo_url": INETSPEED_REPO_URL,
                    "hints": [
                        "安装 speedtest/inetspeed 到 PATH。",
                        "或设置 INETSPEED_CLI_REPO=/path/to/iNetSpeed-CLI。",
                        "或设置 INETSPEED_CLI_CMD 指向可执行命令。",
                    ],
                },
                HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return
        except subprocess.TimeoutExpired:
            self.send_json({"ok": False, "error": "国内测速执行超时，请稍后重试。"}, HTTPStatus.GATEWAY_TIMEOUT)
            return
        except RuntimeError as exc:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_GATEWAY)
            return
        except Exception as exc:
            self.send_json({"ok": False, "error": f"桥接服务异常: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_GATEWAY
        self.send_json(result, status)


def main() -> None:
    server = ThreadingHTTPServer((DEFAULT_HOST, DEFAULT_PORT), EchoHandler)
    print(f"Server running at http://{DEFAULT_HOST}:{DEFAULT_PORT}")
    print("Domestic speed API: POST /api/domestic-speed")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
