# EchoNAT_Project TASK LOG

## 规划（当前）
- 目的：在现有 `Web / CLI / Tests` 结构基础上，为网页端增加“国内测速”能力，并尽量复用 `iNetSpeed-CLI` 的测速资源与结果模型。
- 原则：
  - KISS：先以最小可落地链路接入国内测速，不重做整套测速框架。
  - YAGNI：仅补网页端当前需要的测速入口、结果展示与必要桥接。
  - DRY：抽象统一的测速任务与结果渲染，避免 NAT/测速逻辑重复堆叠。
  - SOLID：将测速数据源、任务编排、界面渲染拆分为单一职责模块。

## 计划分解（当前）
1. 审查当前网页端检测流与 `iNetSpeed-CLI` 能力边界，确定前端接入方案。
2. 设计并实现网页端“国内测速”入口、任务状态与结果展示。
3. 接入 `iNetSpeed-CLI` 数据源或兼容配置，保证测速节点偏国内可用。
4. 执行本地回归验证并整理下一步建议。

## 目标清单
- [x] ~~**目标:** 梳理网页端现状并完成 `iNetSpeed-CLI` 国内测速接入方案设计~~ (创建于: 2026-04-21 18:06:29 | **完成于: 2026-04-21 18:11:43**)
- [x] ~~**目标:** 实现本地桥接服务并封装 `iNetSpeed-CLI` 国内测速 API~~ (创建于: 2026-04-21 18:11:43 | **完成于: 2026-04-21 18:24:40**)
  - 新增：`Web/serve.py`，统一承担静态托管、健康检查和 `/api/domestic-speed` 桥接。
  - 新增：`Web/serve.ps1` 作为 Python 启动器，避免重复维护两套服务逻辑。
- [x] ~~**目标:** 更新网页端 UI 与状态流，接入国内测速展示与错误反馈~~ (创建于: 2026-04-21 18:11:43 | **完成于: 2026-04-21 18:24:40**)
  - 更新：`Web/index.html` 增加国内测速入口与结果区。
  - 更新：`Web/app.js` 拆分 NAT 检测与国内测速两条状态流，并接入桥接 API。
- [x] ~~**目标:** 完成本地回归验证并补充运行说明~~ (创建于: 2026-04-21 18:11:43 | **完成于: 2026-04-21 18:24:40**)
  - 验证：`python3 -m py_compile Web/serve.py`
  - 验证：`node --check Web/app.js`
  - 验证：实跑 `serve.py` + `POST /api/domestic-speed`，成功返回国内节点、延迟、下载、上传 JSON 结果。
- [x] ~~**目标:** 细化网页交互：让 NAT 检测与国内测速完全分开展示，并为测速增加实时跳动中的数值反馈~~ (创建于: 2026-04-21 19:13:03 | **完成于: 2026-04-21 19:20:05**)
  - 更新：`Web/app.js` 为 NAT 与测速分别维护独立日志、显示区与按钮流程。
  - 更新：`Web/index.html` 为测速区补充独立日志卡，并调整测速指标文案。
  - 更新：`Web/style.css` 为测速大数字启用等宽数值显示，提升跳动时可读性。
  - 验证：浏览器实测确认“国内测速”过程中数值实时变化，且不会联动显示 NAT 结果区。
- [x] ~~**目标:** 初始化 Git 仓库并推送项目到 GitHub 仓库 `echo-nat-speed`~~ (创建于: 2026-04-21 19:31:51 | **完成于: 2026-04-21 19:35:01**)
  - 新增：`.gitignore`，排除 `.serena/`、`__pycache__/` 和本地系统垃圾文件。
  - 新增：`README.md`，补项目用途、结构和本地启动方式。
  - 初始化：本地 Git 仓库，提交 `fb0b341`。
  - 推送：已创建并推送到 GitHub 仓库 `zhizhishu/echo-nat-speed`，本地 `main` 已对齐 `origin/main`。
- [x] ~~**目标:** 提供 Docker 与 Docker Compose 可运行版本，内置 `iNetSpeed-CLI` 并完成本地容器验证~~ (创建于: 2026-04-21 19:36:51 | **完成于: 2026-04-21 19:44:40**)
  - 新增：`Dockerfile`，以仓库内 `vendor/iNetSpeed-CLI` 离线构建 `speedtest` 二进制，避免构建阶段依赖 GitHub 拉取源码。
  - 新增：`docker-compose.yml`，提供一键构建与运行入口，并暴露测速相关环境变量覆盖项。
  - 新增：`.dockerignore`，减少构建上下文噪声。
  - 新增：`vendor/iNetSpeed-CLI`，锁定上游 `nxtrace/iNetSpeed-CLI` 提交 `dd6f601b4968ee18c7d4a950490bfcb4d7c608d6`，并补齐 Go vendor 依赖。
  - 更新：`README.md`，补充 Docker / Docker Compose 运行说明与 vendored 依赖说明。
  - 验证：`docker build -t echo-nat-speed:test .`
  - 验证：`HOST_PORT=8090 docker compose up -d --build`
  - 验证：`curl -s http://127.0.0.1:8090/api/health`
  - 验证：`curl -s -X POST http://127.0.0.1:8090/api/domestic-speed ...`
  - 清理：`docker compose down`
- [x] ~~**目标:** 为 README 增加中英文切换链接，并补充中文版本说明文档~~ (创建于: 2026-04-21 19:46:39 | **完成于: 2026-04-21 19:47:28**)
  - 更新：`README.md` 顶部增加 `README.zh-CN.md` 入口，保留英文主页作为默认落地页。
  - 新增：`README.zh-CN.md`，提供与英文版对应的中文使用说明，并在顶部反向链接英文版。
- [x] ~~**目标:** 通过 GitHub Actions 发布 GHCR 公有镜像，并给出 ClawCloud 可直接使用的镜像地址~~ (创建于: 2026-04-22 14:07:24 | **完成于: 2026-04-23 12:22:08**)
  - 已完成：新增 `.github/workflows/publish-ghcr.yml`，推送 `main` 后自动构建并发布 `ghcr.io/zhizhishu/echo-nat-speed:latest`。
  - 已验证：GitHub Actions 运行 `24763362547` 已成功，GHCR 已存在 `latest` 与 `sha-fb9a8f6` 标签版本。
  - 处理：已将 GitHub Container Registry 包 `echo-nat-speed` 可见性切换为 `Public`。
  - 复验：GitHub Packages API 返回 `visibility=public`。
  - 复验：匿名执行 `docker manifest inspect ghcr.io/zhizhishu/echo-nat-speed:latest` 成功，返回 OCI image index，目标平台为 `linux/amd64`。
  - 结果：ClawCloud 可直接使用镜像 `ghcr.io/zhizhishu/echo-nat-speed:latest` 部署。
- [x] ~~**目标:** 将“国内测速”改为用户浏览器真实测速，并将右上角 GitHub 图标指向项目仓库~~ (创建于: 2026-04-23 12:50:13 | **完成于: 2026-04-23 13:00:08**)
  - 更新：`Web/index.html` 将按钮、卡片、日志与提示文案改为“浏览器测速”，并将右上角 GitHub 图标指向 `https://github.com/zhizhishu/echo-nat-speed`。
  - 更新：`Web/app.js` 改为通过浏览器直接调用 `/api/browser-speed/ping`、`/api/browser-speed/download`、`/api/browser-speed/upload`，测量当前用户到部署节点的真实下载、上传与往返延迟。
  - 更新：`README.md` 与 `README.zh-CN.md`，补充浏览器测速为默认能力，并将 `iNetSpeed-CLI` 降级为可选运维诊断能力。
  - 验证：`node --check Web/app.js`
  - 验证：`python3 -m py_compile Web/serve.py`
  - 验证：本地启动 `ECHO_NAT_PORT=8091 python3 Web/serve.py`，实测 `GET /api/browser-speed/ping`、`GET /api/browser-speed/download?bytes=1048576`、`POST /api/browser-speed/upload` 全部成功。
  - 验证：浏览器实跑页面，`浏览器测速` 完成后显示目标节点为 `127.0.0.1:8091`，日志中出现真实下载、上传与延迟结果。
- [x] ~~**目标:** 按 speedtest 风格补齐浏览器测速：分离 NAT/测速按钮、展示单线程/多线程、空载/负载延迟、抖动并完成结果校验~~ (创建于: 2026-04-23 13:06:20 | **完成于: 2026-04-23 13:27:46**)
  - 更新：`Web/index.html` 将测速结果区改为标准指标板，独立展示下载/上传标准值、单线程参考值、空载延迟、下载负载延迟、上传负载延迟、抖动和测速节点。
  - 更新：`Web/app.js` 重构浏览器测速流程为预热、空载延迟、单线程下载、多线程下载、单线程上传、多线程上传六阶段，并以多线程聚合作为标准测速结果。
  - 更新：`Web/serve.py` 修复并发下载时的流式写回背压问题，避免浏览器在多线程测速阶段出现 `ERR_CONTENT_LENGTH_MISMATCH`。
  - 更新：`Web/style.css` 为测速指标板新增卡片布局，提升多指标同时展示的可读性。
  - 验证：`node --check Web/app.js`
  - 验证：`python3 -m py_compile Web/serve.py`
  - 验证：本地启动 `ECHO_NAT_PORT=8092 python3 Web/serve.py`，实测 `GET /api/browser-speed/ping`、`GET /api/browser-speed/download?bytes=1048576`、`POST /api/browser-speed/upload` 全部成功。
  - 验证：Chrome DevTools 打开 `http://127.0.0.1:8092`，点击“浏览器测速”后页面成功完成整套测速流程，并显示单线程、多线程、负载延迟与抖动指标。
