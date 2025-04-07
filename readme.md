# LibreTV - 免费在线视频搜索与观看平台

## 📺 项目简介

LibreTV是一个轻量级、免费的在线视频搜索与观看平台，提供来自多个视频源的内容搜索与播放服务。无需注册，即开即用，支持多种设备访问。项目采用纯前端技术构建，可轻松部署在各类静态网站托管服务上。

本项目基于 https://github.com/bestK/tv

演示站：https://libretv.is-an.org/

<img src="https://testingcf.jsdelivr.net/gh/bestZwei/imgs@master/picgo/image-20250406231222216.png" alt="image-20250406231222216" style="zoom:67%;" />

## ✨ 主要特性

- 🔍 多源视频搜索功能，覆盖电影、电视剧等内容
- 📱 响应式设计，完美支持电脑、平板和手机
- 🌐 聚合多个视频源，自动提取播放链接
- 🔄 支持自定义API接口，灵活扩展
- 💾 本地存储搜索历史，提升使用体验
- 🚀 纯静态部署，无需后端服务器

## 🛠️ 技术栈

- HTML5 + CSS3 + JavaScript (ES6+)
- Tailwind CSS (通过CDN引入)
- 前端API请求拦截技术
- localStorage本地存储

## 🚀 部署指南

### Cloudflare Pages部署

1. Fork或克隆本仓库到你的GitHub账户
2. 登录Cloudflare Dashboard，进入Pages服务
3. 点击"创建项目"，连接GitHub仓库
4. 使用以下设置：
   - 构建命令：留空（无需构建）
   - 输出目录：留空（默认为根目录）
   - 部署命令：留空
5. 点击"保存并部署"

### Vercel/Netlify部署

类似Cloudflare Pages，只需连接仓库并部署即可，无需特殊配置。

### 本地测试

如果你想在本地测试，可以使用任何静态文件服务器：

```bash
# 使用Python
python -m http.server 8080

# 或使用Node.js的http-server
npx http-server -p 8080
```

## 🔧 自定义配置

项目主要配置在`js/config.js`文件中，你可以修改以下内容：

- `PROXY_URL`: 修改为你自己的代理服务地址
- `API_SITES`: 添加或修改视频源API接口
- `SITE_CONFIG`: 更改站点名称、描述等基本信息

## 🌟 项目结构

```
LibreTV/
├── css/
│   └── styles.css       // 自定义样式
├── js/
│   ├── app.js           // 主应用逻辑
│   ├── api.js           // API请求处理
│   ├── config.js        // 全局配置
│   └── ui.js            // UI交互处理
├── index.html           // 主页面
├── robots.txt           // 搜索引擎爬虫配置
└── sitemap.xml          // 站点地图
```

## 📝 使用说明

1. 打开网站，在搜索框中输入想要搜索的视频名称
2. 点击搜索按钮或按Enter键开始搜索
3. 从搜索结果列表中选择想要观看的视频
4. 在视频详情页中选择集数开始观看
5. 可以通过右上角的设置按钮更换数据源或自定义API

## ⚠️ 免责声明

LibreTV仅作为视频搜索工具，不存储、上传或分发任何视频内容。所有视频均来自第三方API接口提供的搜索结果。如有侵权内容，请联系相应的内容提供方。

## 🔄 更新日志

- 1.0.0 (2025-04-06): 初始版本发布