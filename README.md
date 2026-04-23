# Echo NAT Speed

[简体中文](README.zh-CN.md)

Public container image:

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

`EchoNAT_Project` is a lightweight network diagnostics toolkit with:

- WebRTC-based NAT detection in the browser
- IPv6 and MTU checks
- Real browser-side download and upload tests from the user to the current speed node
- An optional server-side `iNetSpeed-CLI` bridge kept for operator-side diagnostics

## Structure

- `Web/`: browser UI, browser speed APIs, and optional CLI bridge server
- `CLI/`: shell and PowerShell NAT detection scripts
- `Tests/`: mock STUN and UDP helpers

## Run locally

```bash
cd Web
python3 serve.py
```

Then open `http://127.0.0.1:8080`.

If you still want to use the optional server-side `iNetSpeed-CLI` bridge API, set `INETSPEED_CLI_REPO` or install `speedtest` into `PATH`.

Note: the default web speed result is always measured by the user's browser. The bundled `iNetSpeed-CLI` API is server-side diagnostics only and should not be treated as the user's speed result.

## Run with Docker

The container image exposes browser speed endpoints by default. It also bundles a vendored copy of `iNetSpeed-CLI` for optional server-side diagnostics, so the host machine does not need to install `speedtest` separately and the image build no longer depends on cloning GitHub during `docker build`.

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

## Vendored dependency

For Docker reliability, the repository includes `vendor/iNetSpeed-CLI`, synced from upstream `nxtrace/iNetSpeed-CLI` commit `dd6f601b4968ee18c7d4a950490bfcb4d7c608d6`.
