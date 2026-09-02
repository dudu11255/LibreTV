# 部署

## Docker（推荐）

```bash
git clone <本仓库>
cd libretv-next

# 设置密码
echo "PASSWORD=your-strong-password" > .env

docker compose up -d --build
# 访问 http://localhost:8080
```

镜像为多阶段构建（`DOCKER_BUILD=1` 时输出 standalone），运行容器不包含构建工具，体积小。

## 镜像分发与版本管理

### 版本号：单一事实来源

版本号**只在 `package.json` 的 `version` 字段维护**：

- `/api/status` 返回的 `version` 由 `next.config.ts` 在构建时读取并注入（`process.env.APP_VERSION`）；
- Docker 镜像 tag 建议与它保持一致，使用者可凭 `/api/status` 的返回值核对部署版本。

改版本只需一处：`npm version patch|minor|major`（会同步更新 `package.json` 并打 git tag）。

### 发布镜像（已自动化）

镜像由 GitHub Actions 自动构建并推送到 **GHCR**：`.github/workflows/docker-publish.yml`。

发布流程（开发者侧只需三步）：

```bash
npm version patch          # 2.0.0 → 2.0.1，自动更新 package.json 并打 git tag
git push
git push --tags
```

推送到 `v*` tag 后，CI 会先校验 tag 与 `package.json` 版本一致（不一致直接失败，防止镜像标签
与 `/api/status` 返回值脱节），再跑类型检查与单测，通过则构建 `linux/amd64` + `linux/arm64`
双架构镜像并推送，产出三个 tag：

- `ghcr.io/bestzwei/libretv:2.0.1`（完整版本）
- `ghcr.io/bestzwei/libretv:2.0`（次版本）
- `ghcr.io/bestzwei/libretv:latest`

无需配置任何 secrets，`GITHUB_TOKEN` 由 GitHub 自动注入并具备 `packages: write` 权限。
首次发布后，需要到仓库的 **Packages** 页面把镜像可见性设为 Public（默认 Private，拉取需要登录）。

### 使用者侧

```bash
git clone <本仓库> && cd libretv
echo "PASSWORD=your-strong-password" > .env
docker compose pull && docker compose up -d     # 拉取 ghcr.io/bestzwei/libretv:latest
```

锁定特定版本时在 `.env` 中设置：

```bash
LIBRETV_IMAGE=ghcr.io/bestzwei/libretv:2.0.1
```

### 本地源码构建（不经过 CI）

`docker-compose.yml` 同时声明了 `build: .` 与 `image:`，本地没有镜像时会用源码构建
（tag 落在 `ghcr.io/bestzwei/libretv:latest`）：

```bash
docker compose up -d --build
```

### 构建上下文

仓库含 `.dockerignore`，`node_modules`/`.next`/文档/日志不会进入构建上下文，
`COPY . .` 不会把本地依赖或构建产物带进镜像，也不会因 `.git` 而使 context 膨胀。

### docker-compose.yml

```yaml
services:
  libretv:
    build: .
    ports: ["8080:8080"]
    environment:
      - PASSWORD=${PASSWORD:?请在 .env 中设置 PASSWORD}
      # - PROXY_SECRET=your-secret
```

## 手动部署

要求 Node.js ≥ 20（推荐 22）：

```bash
npm ci
PASSWORD=your-password npm run build
PASSWORD=your-password npm start          # 默认 8080 端口
```

> 注意：`output: 'standalone'` 仅在 `DOCKER_BUILD=1` 时启用，本地 `next start` 无需（也不兼容）standalone。

### 生产建议

- 使用反向代理（Nginx / Caddy）终结 HTTPS，转发到 8080；
- 会话 Cookie 在生产环境（`NODE_ENV=production`）下自动启用 `Secure`，需 HTTPS 访问；
- 设置 `PROXY_SECRET` 而非依赖 PASSWORD 派生，避免更换密码导致全员会话失效以外的副作用。

## 环境变量

完整列表见 [Configuration](Configuration)。最小可运行配置只有一个 `PASSWORD`。

## 健康检查与验证

```bash
curl http://localhost:8080/api/status
# {"passwordRequired":true,"verified":false,"version":"2.0.0"}

# 未登录访问受保护接口应返回 401
curl -X POST http://localhost:8080/api/search -d '{}' -H 'Content-Type: application/json' -i | head -1
# HTTP/1.1 401 Unauthorized

# SSRF 防护应拦截内网地址
curl -i "http://localhost:8080/api/proxy/http%3A%2F%2F127.0.0.1%3A8080%2F" | head -1
# HTTP/1.1 400/403
```

## 升级

1. `git pull`
2. `npm ci && npm run build`（Docker 部署改为 `docker compose pull && docker compose up -d`，源码构建则为 `docker compose up -d --build`）
3. 用户数据（历史/进度/设置）在浏览器端，升级无感迁移。
4. 可通过 `/api/status` 的 `version` 字段核对线上版本是否已更新。

## 从旧版迁移

- 旧版打开「设置 → 配置文件 → 导出」，新版「设置 → 配置 → 导入配置」选择同一文件即可迁移数据源与观看历史；
- 旧版 localStorage 各零散 key 不会被读取，仅识别标准导出 JSON；
- 旧版的 `PASSWORD` 环境变量直接沿用（明文比对改为服务端恒定时间比较，用户无感知）。

## 开发

```bash
npm install
PASSWORD=dev-password npm run dev    # http://localhost:8080
npm run typecheck                    # TypeScript 检查
npm test                             # 单元测试（cms-parser / m3u8 / ssrf）
```
