# Echo NAT Speed

[简体中文](README.zh-CN.md)

Public container image:

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

`EchoNAT_Project` is a lightweight network diagnostics toolkit with:

- WebRTC-based NAT detection in the browser
- IPv6 and MTU checks
- Real browser-side download and upload tests from the user to the current speed node
- A first-party `inetspeed/` component migrated from `nxtrace/iNetSpeed-CLI` for Apple CDN diagnostics

## Structure

- `Web/`: browser UI, browser speed APIs, and optional CLI bridge server
- `CLI/`: shell and PowerShell NAT detection scripts
- `Tests/`: mock STUN and UDP helpers
- `inetspeed/`: built-in Go speed test component migrated from `nxtrace/iNetSpeed-CLI`

## Run locally

```bash
cd Web
python3 serve.py
```

Then open `http://127.0.0.1:8080`.

The web speed buttons measure traffic from the user's browser to the currently deployed node. The built-in `inetspeed/` component is also exposed through `/api/domestic-speed` for server-side Apple CDN diagnostics.

Note: browsers cannot select Apple CDN endpoint IPs or read Apple CDN response bodies without CORS permission. For that reason, `inetspeed/` diagnostics are clearly kept as server-side diagnostics and are not mixed into browser speed results.

## Run with Docker

The container image exposes browser speed endpoints by default. It also builds the first-party `inetspeed/` component into `/usr/local/bin/speedtest`, so the host machine does not need to install `speedtest` separately and the image build does not clone GitHub during `docker build`.

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
