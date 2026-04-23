# Echo NAT Speed

[English](README.md)

公有镜像地址：

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

`EchoNAT_Project` 是一个轻量级网络诊断工具集，包含：

- 浏览器内基于 WebRTC 的 NAT 检测
- IPv6 与 MTU 检查
- 由一级源码组件 `inetspeed/` 驱动的 Apple CDN 测速诊断
- `Web/serve.py` 中保留可选的浏览器测速 API

## 项目结构

- `Web/`：浏览器端界面、浏览器测速接口与可选 CLI 桥接服务
- `CLI/`：Shell 与 PowerShell NAT 检测脚本
- `Tests/`：模拟 STUN 与 UDP 辅助测试代码
- `inetspeed/`：从 `nxtrace/iNetSpeed-CLI` 迁移而来的内置 Go 测速组件

## 本地运行

```bash
cd Web
python3 serve.py
```

然后打开 `http://127.0.0.1:8080`。

网页上的测速按钮现在直接调用 `/api/domestic-speed`，展示内置 `inetspeed/` 自动选中的 Apple CDN 节点。

`/api/browser-speed/*` 浏览器测速接口仍然保留在后端，但不再作为网页主测速入口。

## 使用 Docker 运行

镜像默认直接提供浏览器测速接口。同时镜像会把一级源码组件 `inetspeed/` 构建到 `/usr/local/bin/speedtest`，宿主机不需要额外安装 `speedtest`，并且 `docker build` 过程中不会从 GitHub 在线拉取源码。

使用 Docker 构建并运行：

```bash
docker build -t echo-nat-speed .
docker run --rm -p 8080:8080 echo-nat-speed
```

使用 Docker Compose 构建并运行：

```bash
docker compose up --build
```

然后打开 `http://127.0.0.1:8080`。

常用覆盖参数：

- `HOST_PORT=8090 docker compose up --build`
- `INETSPEED_TIMEOUT=6 docker compose up --build`
- `INETSPEED_MAX=8M docker compose up --build`
- `INETSPEED_THREADS=4 docker compose up --build`

## 在 ClawCloud 部署

在 ClawCloud Run 里可以直接使用下面这个公有镜像：

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

推荐配置：

- 端口：`8080`
- Public Access：开启
- 实例数：`1`
- 规格：`0.5 vCPU / 512 MB`

## 内置 inetspeed 组件

`inetspeed/` 已经作为本仓库源码的一部分维护，迁移自上游 `nxtrace/iNetSpeed-CLI` 提交 `dd6f601b4968ee18c7d4a950490bfcb4d7c608d6`。Docker 构建会直接编译这个本地组件。
