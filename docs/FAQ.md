# 常见问题 FAQ

### 部署相关

**Q：启动后页面提示「请设置密码」？**
A：未配置 `PASSWORD` 环境变量。请在部署平台的环境变量中加入 `PASSWORD=你的密码`，并重启 / 重新部署。

**Q：Cloudflare Pages 部署后页面异常 / 代理失败？**
A：CF Pages 由 `functions/_middleware.js` 自动注入 `{{PASSWORD}}`（替换为 `sha256(PASSWORD)`）与 `{{PROXY_TOKEN_MODE}}`（兼容模式），直接部署即可正常使用。若仍异常，请确认已在 CF 的 Functions 环境变量中设置 `PASSWORD`，并重新部署。详见[部署指南](Deployment.md)。

**Q：函数平台（Vercel / Netlify）代理返回 401？**
A：函数环境走静态哈希鉴权，需保证 `PASSWORD` 已设置且前端输入一致；改密码后请重新部署。

**Q：Docker 端口访问不了？**
A：默认容器内 `8080`，映射到主机的端口在 `docker run -p` / `docker-compose.yml` 中（如 `8899:8080`），访问宿主机映射端口。

### 播放相关

**Q：搜索有结果但点击播放没反应 / 黑屏？**
A：多为该源播放地址需要代理或防盗链。确认部署正确走了 `/proxy`；如源站直链带 Referer 校验，可调整 `USER_AGENT` 或在源侧处理。

**Q：提示跨域（CORS）错误？**
A：不应出现——所有请求都经服务端代理转发，已规避浏览器跨域。若出现，说明前端没走 `/proxy`，检查部署的 rewrite / 函数路由是否生效。

**Q：HLS 视频加载转圈？**
A：m3u8 经服务端递归改写与缓存，若源站慢会卡顿；可切换清晰度 / 源。

**Q：收藏 / 历史丢了？**
A：保存在浏览器 `localStorage`，清 Cookie、换浏览器或无痕模式会丢失。重要配置请在「设置」中导出备份。

### 安全相关

**Q：为什么推荐设置 `PROXY_SECRET`？**
A：设置后代理改用服务端签发的短时效 token，前端静态哈希不再被接受，可防止他人提取哈希后盗用你的代理。详见[代理鉴权与安全](Proxy-Security.md)。

**Q：代理会访问内网吗？**
A：不会。代理内置 SSRF 防护，拦截 `localhost`、私有网段与云元数据地址。
