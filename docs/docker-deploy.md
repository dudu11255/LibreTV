# Docker 部署（本仓库 fork 版）

> 本仓库是 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV) 的 fork，在官方版基础上补了**分类浏览（`/category`）**模块。
> 因此镜像地址与官方文档不同：官方镜像 `ghcr.io/librespark/libretv` **不含**本仓库的改动。

## 先选一条路线

| | 路线 A：源码构建 | 路线 B：CI 出镜像 |
|---|---|---|
| 适合 | 一台机器、想改就改 | 多台部署 / 低配服务器 / NAS |
| 机器要求 | Docker + **2G 左右可用内存**（`next build` 峰值） | 只要 Docker |
| 首次耗时 | 3–8 分钟（下载基础镜像 + `npm ci` + 构建） | Actions 约 10 分钟，之后 pull 几十秒 |
| 改代码后 | `git pull && docker compose up -d --build` | 推 `main` → 自动出 `edge` → 服务器 `pull && up -d` |

## 路线 A：源码构建

```bash
git clone https://github.com/dudu11255/LibreTV.git
cd LibreTV

cp .env.example .env
# 编辑 .env，至少设置 PASSWORD
#   PASSWORD=你的密码

docker compose up -d --build
docker compose logs -f libretv
```

访问 `http://<机器IP>:8080`。

镜像会被打上 `ghcr.io/dudu11255/libretv:latest` 这个 tag——这是**故意的**，和上游同名才会在手滑 `docker compose pull` 时静默换成官方镜像。想换 tag 就设 `LIBRETV_IMAGE=libretv:local`。

## 路线 B：CI 出镜像，服务器只跑镜像

### 1. 先构建一次镜像

镜像是 Actions 自动发布的，不用手动点：

| 触发 | 产物标签 | 用途 |
|---|---|---|
| 推 `main` 分支 | `edge`、`edge-<短 sha>` | 跟主干的最新构建，适合自己尝鲜 / 排查 |
| 推 `v*` tag | `3.0.5`、`3.0`、`latest` | 正式版；`latest` 只跟 tag 走，不会被 `main` 覆盖 |
| Actions 页面 Run workflow | 由所选 ref 决定 | 手动补构建 |

所以「想让服务器拿到刚推的代码」有两条路：等 `main` 的 `edge` 构建完，或者发一个 tag 出正式版。手动触发仍在 仓库页 → **Actions** → `docker-publish` → **Run workflow**。

> 推包报 403 时去 **Settings → Actions → General → Workflow permissions** 勾上 *Read and write permissions*。

### 2. 让服务器能拉到镜像

GHCR 的包默认是**私有**的，二选一：

- **改成公开**：GitHub 个人页 → Packages → `libretv` → Package settings → Change visibility → Public
- **或者登录**：`docker login ghcr.io -u dudu11255`，密码填一个带 `read:packages` 权限的 PAT（不是账号密码）

### 3. 服务器上只需两个文件

把仓库里的 `docker-compose.server.yml` 和一份 `.env` 放到同一个目录（不需要 clone 整个仓库）：

```bash
# .env
PASSWORD=你的密码
```

```bash
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
docker compose -f docker-compose.server.yml logs -f
```

> 这个编排**没有 `build:`**，所以服务器不需要 Node，也不会因为误操作在服务器上跑构建。

## 更新版本

```bash
# 路线 A
git pull && docker compose up -d --build
```

路线 B 先决定跟哪条线，靠镜像标签切换，不用改别的：

```bash
# 跟主干：每次 main 有新提交，pull 到的就是新 edge
LIBRETV_IMAGE=ghcr.io/dudu11255/libretv:edge

# 跟正式版：只有打了 v* tag 才会变
LIBRETV_IMAGE=ghcr.io/dudu11255/libretv:latest
```

写进 `.env` 后照常：

```bash
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
```

> `edge` 每推一次 `main` 就重新构建一次，标签会频繁移动，NAS 镜像面板提示的「有新版本」多半就是它；`latest` 只在发版时动，所以更安静。
> 需要钉死在某个提交时用 `edge-<短 sha>`，回滚时直接指定那个标签。

## 部署后确认

```bash
curl http://127.0.0.1:8080/api/status
# {"passwordRequired":true,"verified":false,"version":"3.0.5",...}
```

- `version` 与 `package.json` 一致 → 镜像内容正确
- 浏览器登录后顶栏应出现 **分类** 入口，`/category` 能列出大类、按子类与年份筛选并翻页 → 分类模块生效
- 若顶栏只有「直播 / 关于」，说明拿到的是上游镜像，检查 `docker image ls` 里的 image 来源

## 常见问题

**`PASSWORD` 没设置，compose 直接报错**
两个编排都用 `${PASSWORD:?请在 .env 中设置 PASSWORD}` 做了强校验，缺变量会在 `up` 之前就失败，属预期行为。

**端口冲突**
改 `ports` 的左边：`"8090:8080"`。容器内始终监听 8080，不要改右边。

**1G 内存的小机器构建就 OOM**
`next build` 峰值约 1.5G。加 swap，或直接走路线 B（在 GitHub 上构建）。

**国内服务器拉 `node:22-alpine` 很慢**
在 Docker daemon 配 registry mirror（`/etc/docker/daemon.json` 的 `registry-mirrors`）。

**NAS / ARM 设备**
`Dockerfile` 是标准多阶段构建，arm64 上可以直接 `--build`，只是慢；路线 B 的 workflow 里有 `ubuntu-24.04-arm` 原生 runner，出的是 arm64 镜像，更适合这类设备。

**飞牛 / 群晖的镜像面板不提示「有新版本」**

飞牛的「镜像管理」对 `ghcr.io` 的镜像检测不到更新——官方论坛 2024-12 就回「已知问题，正在跟进」，到 2025-08 仍未修；同一列表里 Docker Hub 的镜像能正常提示，所以看起来像「只有你的镜像不更新」。

技术上是这么卡的：GHCR 只对外提供 OCI mediatype 的 manifest，探测方若用 Docker 旧格式或 `*/*` 去要，GHCR 直接回 404（不是 406），面板拿不到远端 digest 就静默跳过，不发任何提示。`docker pull` 本身走的是完整的 Accept 协商，所以命令行永远能正常拉到新镜像。

绕过面板，两个办法：

```bash
# 1) 手动更新（飞牛「终端」或 SSH）
cd /vol1/1000/docker/libretv     # 换成你的 compose 目录
sudo docker compose pull && sudo docker compose up -d
```

```yaml
# 2) 让它自己更新：加一个只盯这一个容器的 watchtower
services:
  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 3600 --cleanup libretv
```

> watchtower 按 digest 比对，对 public 的 GHCR 镜像有效；`libretv` 参数限定只更新这一个容器，不要省掉。
> 面板里的「有新版本」只影响提示，不影响镜像本身是否可拉取。

**公网提供服务**
登录密码是明文 POST 的，务必用 Nginx / Caddy / Traefik 或 Cloudflare 套 HTTPS。登录本身不依赖 HTTPS（cookie 的 `Secure` 按 `x-forwarded-proto` 自动推导），需要强制时设 `COOKIE_SECURE=true`。

**数据会不会丢**
容器无状态：观看历史在浏览器 IndexedDB、设置在 localStorage，换容器不丢；但换浏览器/换设备就没有了。不需要挂数据卷。
