# Echo NAT Speed

[English](README.md)

公有镜像地址：

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

`EchoNAT_Project` 是一个轻量级网络诊断工具集，包含：

- 浏览器内基于 WebRTC 的 NAT 检测
- IPv6 与 MTU 检查
- 通过 `iNetSpeed-CLI` 桥接实现的国内测速能力

## 项目结构

- `Web/`：浏览器端界面与本地桥接服务
- `CLI/`：Shell 与 PowerShell NAT 检测脚本
- `Tests/`：模拟 STUN 与 UDP 辅助测试代码

## 本地运行

```bash
cd Web
INETSPEED_CLI_REPO=/path/to/iNetSpeed-CLI python3 serve.py
```

然后打开 `http://127.0.0.1:8080`。

## 使用 Docker 运行

镜像内已经打包 vendored 版本的 `iNetSpeed-CLI`，宿主机不需要额外安装 `speedtest`，并且 `docker build` 过程中也不再依赖从 GitHub 在线拉取源码。

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

## Vendored 依赖

为了保证 Docker 构建稳定性，仓库内包含 `vendor/iNetSpeed-CLI`，当前同步自上游 `nxtrace/iNetSpeed-CLI` 提交 `dd6f601b4968ee18c7d4a950490bfcb4d7c608d6`。
