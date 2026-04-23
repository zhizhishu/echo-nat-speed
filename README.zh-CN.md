# Echo NAT Speed

[English](README.md)

公有镜像地址：

- `ghcr.io/zhizhishu/echo-nat-speed:latest`

`EchoNAT_Project` 是一个轻量级网络诊断工具集，包含：

- 浏览器内基于 WebRTC 的 NAT 检测
- IPv6 与 MTU 检查
- 基于 `fetch(..., { mode: "no-cors" })` + Resource Timing API 的 Zero-Install Apple 原生直连带宽估算
- 在标准浏览器无法给出可信直连量化时，诚实记录 SOP/CORS 边界
- 当原生侧信道未产出可信结果时，自动回退到可用的 Apple CDN Relay 功能链路
- 由一级源码组件 `inetspeed/` 驱动的可选 Apple CDN 服务端诊断

## 项目结构

- `Web/`：浏览器端界面、原生侧信道逻辑、Relay API 与本地服务
- `CLI/`：Shell 与 PowerShell NAT 检测脚本
- `Tests/`：模拟 STUN 与 UDP 辅助测试代码
- `inetspeed/`：从 `nxtrace/iNetSpeed-CLI` 迁移而来的内置 Go 测速组件

## 本地运行

```bash
cd Web
python3 serve.py
```

然后打开 `http://127.0.0.1:8080`。

## 浏览器测速执行模型

网页测速现在采用“原生优先、Relay 回退”的执行模型：

1. **Zero-Install 原生直连估算**  
   页面现在默认先对 `https://mensura.cdn-apple.com/...` 的 small probe 发起 `no-cors` 请求，等待 `PerformanceResourceTiming` 记录，并尽量用浏览器可见的时间信息估算原生下载吞吐；如果浏览器不暴露 `transferSize` / `encodedBodySize`，页面仍可依赖“已知 challenge 字节数 ÷ 持续时间”直接给出 `Estimated` 结果。单线程和多线程模式都会在回退 Relay 之前，先执行原生 `POST no-cors` 上传侧信道估算。
2. **边界诚实记录**  
   如果资源过大、不适合在页面中完整下载，或浏览器没有暴露可用于计算的 Timing 记录，页面会明确记录限制，而不是伪造原生直连 Mbps。
3. **Relay 回退**  
   `/api/browser-speed/*` 仍保留为功能回退链路；一旦触发，页面会把本次结果明确标记为 `[FALLBACK_SINK]`、`Capability Degradation`、`Sub-optimal`。
4. **可选服务端诊断**  
   `/api/domestic-speed` 继续作为后台运维/诊断接口保留。

> 通过 `Timing Side-Channel` 突破浏览器 `SOP` 限制，实现原生端到端带宽估算的工程实践。

## 本地 CTF 凭证 / jshook

针对本地重定向 CTF 环境，真实域名链路由本地证明门控：

- 默认本地凭证：`jshook_local_env_bypass_192.168.2.1`
- 服务端会静默校验本地上下文，不再向客户端回显凭证元数据
- 可通过 `ECHO_NAT_JSHOOK` 覆盖本地凭证值，以便受控本地运行

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
