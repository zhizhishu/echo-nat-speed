# syntax=docker/dockerfile:1.7

FROM golang:1.25-bookworm AS inetspeed-builder

WORKDIR /src
COPY inetspeed ./inetspeed
WORKDIR /src/inetspeed
RUN CGO_ENABLED=0 go build -mod=vendor -trimpath -ldflags="-s -w" -o /out/speedtest ./cmd/speedtest


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ECHO_NAT_HOST=0.0.0.0 \
    ECHO_NAT_PORT=8080

LABEL org.opencontainers.image.source="https://github.com/zhizhishu/echo-nat-speed"
LABEL org.opencontainers.image.description="Echo NAT Speed bundles NAT detection and domestic speed testing in a single container image."

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=inetspeed-builder /out/speedtest /usr/local/bin/speedtest
COPY Web ./Web
COPY CLI ./CLI
COPY Tests ./Tests
COPY README.md TASK_LOG.md ./

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python3 -c "import json,sys,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)); sys.exit(0 if data.get('speedtestReady') else 1)"

WORKDIR /app/Web
CMD ["python3", "serve.py"]
