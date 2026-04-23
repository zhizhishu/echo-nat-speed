#!/usr/bin/env python3
from __future__ import annotations

import errno
import hmac
import ipaddress
import json
import os
import re
import shlex
import shutil
import subprocess
import socket
import sys
import threading
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter, sleep, time
from urllib.request import Request, urlopen
from urllib.parse import parse_qs, urlparse


WEB_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = WEB_ROOT.parent
DEFAULT_HOST = os.getenv("ECHO_NAT_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.getenv("ECHO_NAT_PORT", "8080"))
INETSPEED_COMPONENT = "Echo NAT Speed 内置 inetspeed"
INETSPEED_REPO = PROJECT_ROOT / "inetspeed"
DEFAULT_BROWSER_DOWNLOAD_BYTES = 32 * 1024 * 1024
MIN_BROWSER_DOWNLOAD_BYTES = 1 * 1024 * 1024
MAX_BROWSER_DOWNLOAD_BYTES = 128 * 1024 * 1024
MAX_BROWSER_UPLOAD_BYTES = 64 * 1024 * 1024
STREAM_CHUNK = os.urandom(16 * 1024)
STREAM_BACKPRESSURE_RETRIES = 24
STREAM_BACKPRESSURE_SLEEP = 0.002
APPLE_CDN_HOST = "mensura.cdn-apple.com"
APPLE_CDN_DOWNLOAD_URL = f"https://{APPLE_CDN_HOST}/api/v1/gm/large"
APPLE_CDN_UPLOAD_URL = f"https://{APPLE_CDN_HOST}/api/v1/gm/slurp"
APPLE_CDN_LATENCY_URL = f"https://{APPLE_CDN_HOST}/api/v1/gm/small"
APPLE_CDN_USER_AGENT = "networkQuality/194.80.3 CFNetwork/3860.400.51 Darwin/25.3.0"
CTF_LOCAL_PROOF = os.getenv("ECHO_NAT_JSHOOK", "jshook_local_env_bypass_192.168.2.1").strip()
CTF_LOCAL_PROOF_HEADER = os.getenv("ECHO_NAT_PROOF_HEADER", "X-EchoNAT-Proof").strip()
CTF_REQUIRE_PROOF_HEADER = os.getenv("ECHO_NAT_REQUIRE_PROOF_HEADER", "0").strip() == "1"
DEFAULT_CORS_ORIGINS = {
    f"http://{DEFAULT_HOST}:{DEFAULT_PORT}",
    f"http://127.0.0.1:{DEFAULT_PORT}",
    f"http://localhost:{DEFAULT_PORT}",
}
ALLOWED_CORS_ORIGINS = {
    item.strip()
    for item in os.getenv("ECHO_NAT_CORS_ORIGINS", ",".join(sorted(DEFAULT_CORS_ORIGINS))).split(",")
    if item.strip()
}
APPLE_DOH_URLS = (
    ("https://cloudflare-dns.com/dns-query?name={host}&type=A", {"Accept": "application/dns-json"}),
    ("https://dns.alidns.com/resolve?name={host}&type=A&short=1", {}),
)
APPLE_DOH_TIMEOUT = 2.0
APPLE_PROBE_TIMEOUT = 3.0
APPLE_TRANSFER_TIMEOUT = 90
APPLE_SESSION_TTL_SECONDS = 180
APPLE_SESSION_LOCK = threading.Lock()
APPLE_SPEED_SESSIONS: dict[str, dict[str, object]] = {}
IPV4_PATTERN = re.compile(rb"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def candidate_repo_paths() -> list[Path]:
    candidates: list[Path] = []
    env_repo = os.getenv("INETSPEED_CLI_REPO", "").strip()
    if env_repo:
        candidates.append(Path(env_repo).expanduser())
    candidates.append(INETSPEED_REPO)
    return candidates


def resolve_cli_command() -> tuple[list[str], Path | None, dict[str, str]]:
    custom_cmd = os.getenv("INETSPEED_CLI_CMD", "").strip()
    if custom_cmd:
        return shlex.split(custom_cmd), None, {
            "mode": "command",
            "source": "INETSPEED_CLI_CMD",
            "component": INETSPEED_COMPONENT,
        }

    go_bin = shutil.which("go")
    repo_found = False
    for repo_path in candidate_repo_paths():
        if (repo_path / "cmd" / "speedtest" / "main.go").exists():
            repo_found = True
            if go_bin:
                return [go_bin, "run", "./cmd/speedtest"], repo_path, {
                    "mode": "repo",
                    "source": str(repo_path),
                    "component": INETSPEED_COMPONENT,
                }

    for executable in ("speedtest", "inetspeed"):
        resolved = shutil.which(executable)
        if resolved:
            return [resolved], None, {
                "mode": "binary",
                "source": resolved,
                "component": INETSPEED_COMPONENT,
            }

    if repo_found:
        raise FileNotFoundError(
            "已找到内置 inetspeed 源码，但当前环境没有 go 命令。"
            "请安装 Go，或使用 Docker 镜像内置的 speedtest 二进制，"
            "或设置 INETSPEED_CLI_CMD 指向可执行命令。"
        )

    raise FileNotFoundError(
        "未找到内置 inetspeed 组件。请确认仓库包含 inetspeed/，"
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


def clamp_int(raw_value: str | None, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(raw_value or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def write_stream_chunk(handler: SimpleHTTPRequestHandler, chunk: bytes) -> bool:
    retries = 0
    while True:
        try:
            handler.wfile.write(chunk)
            return True
        except (BrokenPipeError, ConnectionResetError):
            return False
        except OSError as exc:
            if exc.errno in (errno.ENOBUFS, errno.EAGAIN, errno.EWOULDBLOCK) and retries < STREAM_BACKPRESSURE_RETRIES:
                retries += 1
                sleep(STREAM_BACKPRESSURE_SLEEP)
                continue
            return False


def local_proof_active() -> bool:
    return bool(CTF_LOCAL_PROOF)


def request_has_local_proof(headers) -> bool:
    supplied = str(headers.get(CTF_LOCAL_PROOF_HEADER, "")).strip()
    return bool(supplied and CTF_LOCAL_PROOF and hmac.compare_digest(supplied, CTF_LOCAL_PROOF))


def validate_local_context(headers) -> bool:
    if not local_proof_active():
        return False
    if CTF_REQUIRE_PROOF_HEADER:
        return request_has_local_proof(headers)
    return True


def fetch_url_bytes(url: str, headers: dict[str, str] | None = None, timeout: float = APPLE_DOH_TIMEOUT) -> bytes:
    request_headers = {
        "User-Agent": "Echo NAT Speed",
        **(headers or {}),
    }
    request = Request(url, headers=request_headers)
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def extract_ipv4s_from_body(body: bytes) -> list[str]:
    ips: list[str] = []
    seen: set[str] = set()

    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None

    if isinstance(payload, dict):
        answers = payload.get("Answer")
        if isinstance(answers, list):
            for answer in answers:
                if not isinstance(answer, dict):
                    continue
                candidate = str(answer.get("data", "")).strip()
                try:
                    if ipaddress.ip_address(candidate).version == 4 and candidate not in seen:
                        seen.add(candidate)
                        ips.append(candidate)
                except ValueError:
                    continue
    elif isinstance(payload, list):
        for item in payload:
            candidate = str(item).strip()
            try:
                if ipaddress.ip_address(candidate).version == 4 and candidate not in seen:
                    seen.add(candidate)
                    ips.append(candidate)
            except ValueError:
                continue

    for match in IPV4_PATTERN.findall(body):
        candidate = match.decode("utf-8")
        try:
            if ipaddress.ip_address(candidate).version == 4 and candidate not in seen:
                seen.add(candidate)
                ips.append(candidate)
        except ValueError:
            continue

    return ips


def resolve_system_ipv4(host: str) -> str | None:
    try:
        addr_info = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return None

    for family, _, _, _, sockaddr in addr_info:
        if family == socket.AF_INET:
            return sockaddr[0]
    return None


def resolve_apple_candidates() -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []
    seen: set[str] = set()

    for template, headers in APPLE_DOH_URLS:
        try:
            body = fetch_url_bytes(template.format(host=APPLE_CDN_HOST), headers=headers, timeout=APPLE_DOH_TIMEOUT)
        except Exception:
            continue

        for ip in extract_ipv4s_from_body(body):
            if ip in seen:
                continue
            seen.add(ip)
            candidates.append({"ip": ip, "source": "doh"})

    if candidates:
        return candidates

    fallback_ip = resolve_system_ipv4(APPLE_CDN_HOST)
    if fallback_ip:
        return [{"ip": fallback_ip, "source": "system_dns"}]
    return []


def resolve_curl_binary() -> str:
    curl_bin = shutil.which("curl")
    if curl_bin:
        return curl_bin
    raise FileNotFoundError("未找到 curl，无法建立 Apple CDN 浏览器测速桥接。")


def build_apple_curl_base(endpoint_ip: str, max_time: float) -> list[str]:
    curl_bin = resolve_curl_binary()
    return [
        curl_bin,
        "--http2",
        "--resolve",
        f"{APPLE_CDN_HOST}:443:{endpoint_ip}",
        "--connect-timeout",
        "2",
        "--max-time",
        str(max_time),
        "-sS",
        "-H",
        f"User-Agent: {APPLE_CDN_USER_AGENT}",
        "-H",
        "Accept: */*",
        "-H",
        "Accept-Encoding: identity",
    ]


def probe_apple_endpoint(endpoint_ip: str) -> float:
    completed = subprocess.run(
        [
            *build_apple_curl_base(endpoint_ip, APPLE_PROBE_TIMEOUT),
            "-o",
            os.devnull,
            "-w",
            "%{time_total}",
            APPLE_CDN_LATENCY_URL,
        ],
        capture_output=True,
        text=True,
        timeout=int(APPLE_PROBE_TIMEOUT) + 2,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or f"curl exit={completed.returncode}"
        raise RuntimeError(detail)
    return float(completed.stdout.strip()) * 1000


def choose_apple_endpoint() -> dict[str, object]:
    candidates = resolve_apple_candidates()
    if not candidates:
        raise RuntimeError("无法解析 Apple CDN 可用节点。")

    ranked: list[dict[str, object]] = []
    for candidate in candidates[:8]:
        endpoint_ip = str(candidate["ip"])
        try:
            ranked.append(
                {
                    "ip": endpoint_ip,
                    "rttMs": round(probe_apple_endpoint(endpoint_ip), 1),
                    "source": candidate["source"],
                    "status": "ok",
                }
            )
        except Exception:
            continue

    if ranked:
        ranked.sort(key=lambda item: float(item["rttMs"]))
        return ranked[0]

    degraded = dict(candidates[0])
    degraded["rttMs"] = None
    degraded["status"] = "degraded"
    return degraded


def prune_apple_sessions() -> None:
    expires_before = time() - APPLE_SESSION_TTL_SECONDS
    expired = [token for token, session in APPLE_SPEED_SESSIONS.items() if float(session.get("updatedAt", 0)) < expires_before]
    for token in expired:
        APPLE_SPEED_SESSIONS.pop(token, None)


def create_apple_speed_session(endpoint: dict[str, object]) -> tuple[str, dict[str, object]]:
    session_id = uuid.uuid4().hex
    session = {
        "endpointIp": endpoint.get("ip"),
        "endpointRttMs": endpoint.get("rttMs"),
        "endpointSource": endpoint.get("source"),
        "endpointStatus": endpoint.get("status", "ok"),
        "updatedAt": time(),
    }
    with APPLE_SESSION_LOCK:
        prune_apple_sessions()
        APPLE_SPEED_SESSIONS[session_id] = session
    return session_id, session


def load_apple_speed_session(session_id: str | None) -> dict[str, object] | None:
    if not session_id:
        return None
    with APPLE_SESSION_LOCK:
        prune_apple_sessions()
        session = APPLE_SPEED_SESSIONS.get(session_id)
        if not session:
            return None
        session["updatedAt"] = time()
        return dict(session)


def session_payload(session_id: str, session: dict[str, object]) -> dict[str, object]:
    return {
        "sessionId": session_id,
        "endpoint": {
            "host": APPLE_CDN_HOST,
            "ip": session.get("endpointIp"),
            "rttMs": session.get("endpointRttMs"),
            "source": session.get("endpointSource"),
            "status": session.get("endpointStatus"),
        },
        "expiresInMs": APPLE_SESSION_TTL_SECONDS * 1000,
    }


def run_domestic_speed(payload: dict[str, object]) -> dict[str, object]:
    base_cmd, cwd, source = resolve_cli_command()
    cmd = [*base_cmd, *build_speedtest_args(payload)]
    env = os.environ.copy()
    if local_proof_active():
        env["ECHO_NAT_JSHOOK"] = CTF_LOCAL_PROOF
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
        raise RuntimeError(f"inetspeed 返回了无法解析的 JSON: {exc}") from exc
    if not isinstance(data, dict):
        detail = stderr or stdout or "inetspeed 未返回可解析的 JSON。"
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

    def send_cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_CORS_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def ensure_local_context(self) -> bool:
        if validate_local_context(self.headers):
            return True
        self.send_json({"ok": False, "error": "本地验证上下文未激活。"}, HTTPStatus.FORBIDDEN)
        return False

    def send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_binary_headers(self, content_length: int | None = None, extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        if content_length is not None:
            self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Encoding", "identity")
        self.send_cors_headers()
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            curl_ready = shutil.which("curl") is not None
            try:
                command, cwd, source = resolve_cli_command()
                self.send_json(
                    {
                        "ok": True,
                        "browserSpeedReady": curl_ready,
                        "browserSpeedMode": "apple-relay",
                        "appleRelayReady": curl_ready,
                        "appleRelayHost": APPLE_CDN_HOST,
                        "speedtestReady": True,
                        "bridge": "python",
                        "component": source.get("component"),
                        "commandMode": source.get("mode"),
                        "command": command,
                        "workingDirectory": str(cwd) if cwd else None,
                        "commandSource": source.get("source"),
                    }
                )
            except FileNotFoundError as exc:
                self.send_json(
                    {
                        "ok": True,
                        "browserSpeedReady": curl_ready,
                        "speedtestReady": False,
                        "bridge": "python",
                        "component": INETSPEED_COMPONENT,
                        "error": str(exc),
                    }
                )
            return

        if parsed.path == "/api/browser-speed/ping":
            if not self.ensure_local_context():
                return
            query = parse_qs(parsed.query)
            session = load_apple_speed_session(query.get("session", [""])[0])
            if not session:
                self.send_json({"ok": False, "error": "测速会话不存在或已过期，请重新开始测速。"}, HTTPStatus.BAD_REQUEST)
                return
            try:
                upstream_latency_ms = round(probe_apple_endpoint(str(session.get("endpointIp"))), 1)
            except FileNotFoundError as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            except Exception as exc:
                self.send_json({"ok": False, "error": f"Apple 延迟探测失败: {exc}"}, HTTPStatus.BAD_GATEWAY)
                return

            self.send_json(
                {
                    "ok": True,
                    "browserSpeedReady": True,
                    "serverTimeMs": int(time() * 1000),
                    "upstreamLatencyMs": upstream_latency_ms,
                    "endpoint": {
                        "host": APPLE_CDN_HOST,
                        "ip": session.get("endpointIp"),
                        "rttMs": session.get("endpointRttMs"),
                        "source": session.get("endpointSource"),
                        "status": session.get("endpointStatus"),
                    },
                }
            )
            return

        if parsed.path == "/api/browser-speed/download":
            if not self.ensure_local_context():
                return
            query = parse_qs(parsed.query)
            session = load_apple_speed_session(query.get("session", [""])[0])
            if not session:
                self.send_json({"ok": False, "error": "测速会话不存在或已过期，请重新开始测速。"}, HTTPStatus.BAD_REQUEST)
                return
            requested_bytes = clamp_int(
                query.get("bytes", [str(DEFAULT_BROWSER_DOWNLOAD_BYTES)])[0],
                default=DEFAULT_BROWSER_DOWNLOAD_BYTES,
                minimum=MIN_BROWSER_DOWNLOAD_BYTES,
                maximum=MAX_BROWSER_DOWNLOAD_BYTES,
            )
            cmd = [
                *build_apple_curl_base(str(session.get("endpointIp")), APPLE_TRANSFER_TIMEOUT),
                "--no-buffer",
                "-L",
                "-o",
                "-",
                APPLE_CDN_DOWNLOAD_URL,
            ]
            process = None
            response_started = False
            try:
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=0,
                )
                if not process.stdout:
                    raise RuntimeError("未能打开 Apple 下载输出流。")
                first_chunk = process.stdout.read(min(64 * 1024, requested_bytes))
                if not first_chunk:
                    stderr = process.stderr.read().decode("utf-8", errors="ignore").strip() if process.stderr else ""
                    process.wait(timeout=5)
                    raise RuntimeError(stderr or "Apple 下载桥接没有返回数据。")

                self.send_binary_headers(
                    None,
                    {
                        "X-Echo-Apple-Endpoint": str(session.get("endpointIp")),
                        "X-Echo-Apple-Source": str(session.get("endpointSource")),
                    },
                )
                response_started = True
                if not write_stream_chunk(self, first_chunk):
                    return

                remaining = requested_bytes - len(first_chunk)
                while remaining > 0:
                    chunk = process.stdout.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    if not write_stream_chunk(self, chunk):
                        return
                    remaining -= len(chunk)
            except FileNotFoundError as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            except Exception as exc:
                if response_started or self.wfile.closed:
                    return
                self.send_json({"ok": False, "error": f"Apple 下载桥接失败: {exc}"}, HTTPStatus.BAD_GATEWAY)
                return
            finally:
                if process and process.poll() is None:
                    process.kill()
                if process:
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/browser-speed/session":
            if not self.ensure_local_context():
                return
            try:
                endpoint = choose_apple_endpoint()
                session_id, session = create_apple_speed_session(endpoint)
            except FileNotFoundError as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            except Exception as exc:
                self.send_json({"ok": False, "error": f"Apple 节点选点失败: {exc}"}, HTTPStatus.BAD_GATEWAY)
                return

            payload = session_payload(session_id, session)
            payload["ok"] = True
            self.send_json(payload)
            return

        if parsed.path == "/api/browser-speed/upload":
            if not self.ensure_local_context():
                return
            query = parse_qs(parsed.query)
            session = load_apple_speed_session(query.get("session", [""])[0])
            if not session:
                self.send_json({"ok": False, "error": "测速会话不存在或已过期，请重新开始测速。"}, HTTPStatus.BAD_REQUEST)
                return
            content_length = clamp_int(
                self.headers.get("Content-Length"),
                default=0,
                minimum=0,
                maximum=MAX_BROWSER_UPLOAD_BYTES,
            )
            if content_length <= 0:
                self.send_json({"ok": False, "error": "上传体不能为空。"}, HTTPStatus.BAD_REQUEST)
                return

            raw_length = self.headers.get("Content-Length")
            if raw_length is not None and int(raw_length) > MAX_BROWSER_UPLOAD_BYTES:
                self.send_json(
                    {
                        "ok": False,
                        "error": f"上传体过大，单次上传不能超过 {MAX_BROWSER_UPLOAD_BYTES // (1024 * 1024)} MiB。",
                    },
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                )
                return

            received = 0
            started = perf_counter()
            process = None
            try:
                process = subprocess.Popen(
                    [
                        *build_apple_curl_base(str(session.get("endpointIp")), APPLE_TRANSFER_TIMEOUT),
                        "-o",
                        os.devnull,
                        "-T",
                        "-",
                        APPLE_CDN_UPLOAD_URL,
                    ],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    bufsize=0,
                )
                if not process.stdin:
                    raise RuntimeError("未能打开 Apple 上传输入流。")

                while received < content_length:
                    chunk = self.rfile.read(min(64 * 1024, content_length - received))
                    if not chunk:
                        break
                    process.stdin.write(chunk)
                    process.stdin.flush()
                    received += len(chunk)

                process.stdin.close()
                process.stdin = None
                exit_code = process.wait(timeout=APPLE_TRANSFER_TIMEOUT + 5)
                stderr = process.stderr.read().decode("utf-8", errors="ignore").strip() if process.stderr else ""
                if exit_code != 0:
                    raise RuntimeError(stderr or f"curl exit={exit_code}")
            except FileNotFoundError as exc:
                self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            except BrokenPipeError as exc:
                stderr = process.stderr.read().decode("utf-8", errors="ignore").strip() if process and process.stderr else ""
                self.send_json({"ok": False, "error": f"Apple 上传桥接中断: {stderr or exc}"}, HTTPStatus.BAD_GATEWAY)
                return
            except Exception as exc:
                self.send_json({"ok": False, "error": f"Apple 上传桥接失败: {exc}"}, HTTPStatus.BAD_GATEWAY)
                return
            finally:
                if process and process.stdin:
                    process.stdin.close()
                if process and process.poll() is None:
                    process.kill()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()

            self.send_json(
                {
                    "ok": True,
                    "receivedBytes": received,
                    "durationMs": round((perf_counter() - started) * 1000, 2),
                    "endpoint": {
                        "host": APPLE_CDN_HOST,
                        "ip": session.get("endpointIp"),
                        "rttMs": session.get("endpointRttMs"),
                        "source": session.get("endpointSource"),
                        "status": session.get("endpointStatus"),
                    },
                }
            )
            return

        if parsed.path not in ("/api/domestic-speed", "/api/domestic-speedtest"):
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        if not self.ensure_local_context():
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
                    "component": INETSPEED_COMPONENT,
                    "hints": [
                        "默认使用仓库内 inetspeed/ 源码组件。",
                        "本地源码运行需要安装 Go；Docker 镜像已内置 speedtest 二进制。",
                        "也可以设置 INETSPEED_CLI_CMD 指向自定义可执行命令。",
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
    print("Browser speed APIs: POST /api/browser-speed/session, GET /api/browser-speed/ping, GET /api/browser-speed/download, POST /api/browser-speed/upload")
    print("Domestic speed API: POST /api/domestic-speed")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
