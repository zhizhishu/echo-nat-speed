# Echo NAT Speed

[简体中文](README.zh-CN.md)

Public container image:

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

`EchoNAT_Project` is a lightweight network diagnostics toolkit with:

- WebRTC-based NAT detection in the browser
- IPv6 and MTU checks
- A Zero-Install Apple speed-test path that uses `fetch(..., { mode: "no-cors" })` plus the Resource Timing API to estimate native direct throughput when the browser exposes enough timing signals
- Honest browser-boundary reporting when SOP/CORS blocks trustworthy direct quantification
- Automatic relay fallback for functional testing when the native path cannot produce a credible estimate
- Optional Apple CDN server-side diagnostics powered by the first-party `inetspeed/` component migrated from `nxtrace/iNetSpeed-CLI`

## Structure

- `Web/`: browser UI, native side-channel logic, relay APIs, and local server
- `CLI/`: shell and PowerShell NAT detection scripts
- `Tests/`: mock STUN and UDP helpers
- `inetspeed/`: built-in Go speed test component migrated from `nxtrace/iNetSpeed-CLI`

## Run locally

```bash
cd Web
python3 serve.py
```

Then open `http://127.0.0.1:8080`.

## Browser speed execution model

The web UI now uses a native-first execution model:

1. **Zero-Install native direct estimate**  
   The page now defaults to a small known-byte probe on `https://mensura.cdn-apple.com/...`, waits for `PerformanceResourceTiming`, and tries to estimate throughput from timing data. If the browser does not expose `transferSize` / `encodedBodySize`, the page can still surface an `Estimated` result because the default challenge size is already known.
2. **Honest boundary handling**  
   If the resource is too large to download safely in-page, or no usable timing record is exposed, the UI records the limitation explicitly instead of fabricating a direct Mbps result.
3. **Relay fallback**  
   `/api/browser-speed/*` remains available as a fallback path. When this happens, the UI marks the run as `[FALLBACK_SINK]`, `Capability Degradation`, and `Sub-optimal`.
4. **Optional backend diagnostics**  
   `/api/domestic-speed` remains a server-side diagnostic API for operators.

> 通过 `Timing Side-Channel` 突破浏览器 `SOP` 限制，实现原生端到端带宽估算的工程实践。

## Local CTF proof / jshook

For the local redirected CTF environment, real-domain paths are gated by a local proof:

- Default local proof: `jshook_local_env_bypass_192.168.2.1`
- The server validates the local context silently and does not echo proof metadata back to clients
- Set `ECHO_NAT_JSHOOK` to override the local proof value for controlled local runs

## Run with Docker

The container image exposes the browser speed endpoints by default. It also builds the first-party `inetspeed/` component into `/usr/local/bin/speedtest`, so the host machine does not need to install `speedtest` separately and the image build does not clone GitHub during `docker build`.

Build and run with Docker:

```bash
docker build -t echo-nat-speed .
docker run --rm -p 8080:8080 echo-nat-speed
```

Build and run with Docker Compose:

```bash
docker compose up --build
```

Then open `http://127.0.0.1:8080`.

Useful overrides:

- `HOST_PORT=8090 docker compose up --build`
- `INETSPEED_TIMEOUT=6 docker compose up --build`
- `INETSPEED_MAX=8M docker compose up --build`
- `INETSPEED_THREADS=4 docker compose up --build`

## Deploy on ClawCloud

For ClawCloud Run, you can deploy directly from the public image:

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

Recommended app settings:

- Port: `8080`
- Public access: enabled
- Replicas: `1`
- CPU / Memory: `0.5 vCPU / 512 MB`

## Built-in inetspeed component

`inetspeed/` is now part of this repository, migrated from upstream `nxtrace/iNetSpeed-CLI` commit `dd6f601b4968ee18c7d4a950490bfcb4d7c608d6`. Docker builds compile this local component directly.
