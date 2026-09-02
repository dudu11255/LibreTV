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
2. `npm ci && npm run build`（或 `docker compose up -d --build`）
3. 用户数据（历史/进度/设置）在浏览器端，升级无感迁移。

## 从旧版迁移

- 旧版打开「设置 → 配置文件 → 导出」，新版「设置 → 配置 → 导入配置」选择同一文件即可迁移数据源与观看历史；
- 旧版 localStorage 各零散 key 不会被读取，仅识别标准导出 JSON；
- 旧版的 `PASSWORD` 环境变量直接沿用（明文比对改为服务端恒定时间比较，用户无感知）。

## 开发

```bash
npm install
PASSWORD=dev-password npm dev        # http://localhost:8080
npm run typecheck                    # TypeScript 检查
npm test                             # 单元测试（cms-parser / m3u8 / ssrf）
```
