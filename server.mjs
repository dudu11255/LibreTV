import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import dns from 'node:dns';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true'
};

const log = (...args) => {
  if (config.debug) {
    console.log('[DEBUG]', ...args);
  }
};

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

function sha256Hash(input) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    resolve(hash.digest('hex'));
  });
}

async function renderPage(filePath, password) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (password !== '') {
    const sha256 = await sha256Hash(password);
    content = content.replace('{{PASSWORD}}', sha256);
  } else {
    content = content.replace('{{PASSWORD}}', '');
  }
  // 注入代理鉴权模式：配置了 PROXY_SECRET 即启用服务端签发的短时效 token（前端不再持有可伪造的静态哈希）
  const tokenMode = process.env.PROXY_SECRET ? '1' : '';
  content = content.replace('{{PROXY_TOKEN_MODE}}', tokenMode);
  return content;
}

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    let filePath;
    switch (req.path) {
      case '/player.html':
        filePath = path.join(__dirname, 'player.html');
        break;
      default: // '/' 和 '/index.html'
        filePath = path.join(__dirname, 'index.html');
        break;
    }
    
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    console.error('页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    console.error('搜索页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

function isPrivateIP(ip) {
  // 拒绝私有/回环/链路本地/保留地址，防止 SSRF
  if (/^(127\.|0\.0\.0\.0$|::1$|fe80:|fc|fd)/i.test(ip)) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;        // 链路本地（含云元数据 169.254.169.254）
  if (ip.startsWith('100.64.')) return true;         // CGNAT
  if (ip.startsWith('192.0.0.')) return true;        // 协议分配块
  return false;
}

function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const allowedProtocols = ['http:', 'https:'];
    if (!allowedProtocols.includes(parsed.protocol)) return false;
    
    // 从环境变量获取阻止的主机名列表
    const blockedHostnames = (process.env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1').split(',');
    if (blockedHostnames.includes(parsed.hostname)) return false;
    
    // 从环境变量获取阻止的 IP 前缀（保留原逻辑，作为字面量 IP 的快速拦截）
    const blockedPrefixes = (process.env.BLOCKED_IP_PREFIXES || '192.168.,10.,172.').split(',');
    for (const prefix of blockedPrefixes) {
      if (parsed.hostname.startsWith(prefix)) return false;
    }
    
    // 字面量 IP 直接判定
    const host = parsed.hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
      if (isPrivateIP(host)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// 通过 DNS 解析目标主机名，拒绝解析到内网/保留地址的域名（SSRF 深度防护）
async function isBlockedByDNS(urlString) {
  try {
    const { hostname } = new URL(urlString);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
      return isPrivateIP(hostname);
    }
    const result = await dns.lookup(hostname, { all: true });
    return result.some(r => isPrivateIP(r.address));
  } catch {
    return false; // 解析失败不阻断，交给后续请求处理
  }
}

// 将 m3u8 中的绝对地址改写为经过本代理的地址（分片/key/map 同样改写），便于跨域播放
function makeAbsolute(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function rewriteM3u8(content, baseUrl, depth = 0) {
  if (depth > 5) return content;
  const lines = content.split('\n');
  const out = lines.map(line => {
    // #EXT-X-KEY / #EXT-X-MAP 内的 URI="..."
    if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
      return line.replace(/(URI=")([^"]+)(")/g, (m, p1, uri, p2) => {
        if (uri.startsWith('/proxy/')) return m;
        return p1 + '/proxy/' + encodeURIComponent(makeAbsolute(uri, baseUrl)) + p2;
      });
    }
    if (line.startsWith('#') || line.trim() === '') return line;
    if (line.startsWith('/proxy/')) return line;
    return '/proxy/' + encodeURIComponent(makeAbsolute(line, baseUrl));
  });
  return out.join('\n');
}

// 代理鉴权密钥：优先使用服务端独享的 PROXY_SECRET；否则由访问密码派生（客户端仅持有 sha256(password)，无法反推）
function getProxySecret() {
  if (process.env.PROXY_SECRET) return process.env.PROXY_SECRET;
  if (config.password) return crypto.createHash('sha256').update(config.password + ':libretv::proxy-salt').digest('hex');
  return '';
}

// 签发/校验短时效 token：token = sha256(secret + ':' + t)
function signProxyToken(t) {
  const secret = getProxySecret();
  if (!secret) return '';
  return crypto.createHash('sha256').update(secret + ':' + t).digest('hex');
}

function verifyProxyToken(token, t) {
  if (!token || !t) return false;
  const expected = signProxyToken(t);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10分钟
  return Math.abs(now - parseInt(t, 10)) <= maxAge;
}

// 验证代理请求的鉴权
// 配置了 PROXY_SECRET 时：必须使用服务端签发的短时效 token，拒绝前端持有的静态哈希（修复可被伪造的鉴权）
// 未配置时：回退为静态哈希（兼容旧部署；该哈希暴露在页面中，安全性较弱）
function validateProxyAuth(req) {
  const serverPassword = config.password;
  if (!serverPassword) {
    console.error('服务器未设置 PASSWORD 环境变量，代理访问被拒绝');
    return false;
  }
  const token = req.query.token;
  const t = req.query.t;
  if (verifyProxyToken(token, t)) return true;

  if (!process.env.PROXY_SECRET) {
    const authHash = req.query.auth;
    const serverHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
    if (authHash && authHash === serverHash) {
      if (t) {
        const now = Date.now();
        if (now - parseInt(t, 10) > 10 * 60 * 1000) return false;
      }
      return true;
    }
  }
  return false;
}

app.get('/proxy/:encodedUrl', async (req, res) => {
  try {
    // 验证鉴权
    if (!validateProxyAuth(req)) {
      return res.status(401).json({
        success: false,
        error: '代理访问未授权：请先通过 /api/proxy-token 获取 token'
      });
    }

    const encodedUrl = req.params.encodedUrl;
    const targetUrl = decodeURIComponent(encodedUrl);

    // 安全验证
    if (!isValidUrl(targetUrl)) {
      return res.status(400).send('无效的 URL');
    }

    // SSRF 深度防护：解析域名后拦截内网/保留地址
    if (await isBlockedByDNS(targetUrl)) {
      return res.status(403).send('不允许访问私有/保留网络地址');
    }

    log(`代理请求: ${targetUrl}`);

    // 添加请求超时和重试逻辑
    const maxRetries = config.maxRetries;
    let retries = 0;
    
    const makeRequest = async () => {
      try {
        // 针对豆瓣图片：强制豆瓣 Referer 以绕过 418 防盗链（对齐 LunaTV 的图片代理做法）
        const reqHeaders = { 'User-Agent': config.userAgent };
        try {
          if (new URL(targetUrl).hostname.endsWith('doubanio.com')) {
            reqHeaders['Referer'] = 'https://movie.douban.com/';
          }
        } catch (e) { /* 忽略非法 URL */ }
        return await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          timeout: config.timeout,
          headers: reqHeaders
        });
      } catch (error) {
        if (retries < maxRetries) {
          retries++;
          log(`重试请求 (${retries}/${maxRetries}): ${targetUrl}`);
          return makeRequest();
        }
        throw error;
      }
    };

    const response = await makeRequest();

    const contentType = response.headers['content-type'] || '';
    const isM3u8 = contentType.includes('mpegurl') || contentType.includes('x-mpegurl') ||
                  targetUrl.toLowerCase().endsWith('.m3u8');

    // 转发响应头（过滤敏感头）
    const headers = { ...response.headers };
    const sensitiveHeaders = (
      process.env.FILTERED_HEADERS ||
      'content-security-policy,cookie,set-cookie,x-frame-options,access-control-allow-origin'
    ).split(',');
    sensitiveHeaders.forEach(header => delete headers[header]);
    res.set(headers);
    res.set('Access-Control-Allow-Origin', '*');

    // m3u8 文本：重写内部绝对地址为 /proxy/...，使自托管与 Vercel/CF 行为一致（修复分片直连导致 CORS 失败）
    if (isM3u8) {
      const chunks = [];
      for await (const chunk of response.data) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewriteM3u8(text, targetUrl));
      return;
    }

    // 其余（JSON / 分片 / key 等）直接透传
    response.data.pipe(res);
  } catch (error) {
    console.error('代理请求错误:', error.message);
    if (error.response) {
      res.status(error.response.status || 500);
      if (error.response.data && typeof error.response.data.pipe === 'function') {
        error.response.data.pipe(res);
      } else {
        res.send(`请求失败: ${error.message}`);
      }
    } else {
      res.status(500).send(`请求失败: ${error.message}`);
    }
  }
});

// 签发代理短时效 token：需提供访问密码（明文），校验通过后用服务端密钥签名
app.get('/api/proxy-token', (req, res) => {
  const password = req.query.password || '';
  const serverPassword = config.password;
  if (!serverPassword) {
    return res.status(401).json({ success: false, error: '服务器未设置 PASSWORD' });
  }
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const serverHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  if (hash !== serverHash) {
    return res.status(401).json({ success: false, error: '密码错误' });
  }
  const t = Date.now();
  const token = signProxyToken(t);
  res.json({ success: true, token, t });
});

// 防止将服务端源码（server.mjs / 配置 / 函数目录等）当作静态文件暴露
app.use((req, res, next) => {
  const p = req.path.split('?')[0];
  if (/\/(server\.mjs|package\.json|package-lock\.json|Dockerfile|docker-compose\.yml|README\.md|LICENSE|api|functions|netlify|node_modules|\.env|VERSION\.txt)/i.test(p)) {
    return res.status(404).send('Not Found');
  }
  next();
});

app.use(express.static(path.join(__dirname), {
  maxAge: config.cacheMaxAge,
  setHeaders: (res, filePath) => {
    // 前端脚本/样式/页面不缓存，改动后刷新即生效（避免旧 config.js 缓存导致设置不生效）
    if (/\.(js|mjs|css|html)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`);
  if (config.password !== '') {
    console.log('用户登录密码已设置');
  } else {
    console.log('警告: 未设置 PASSWORD 环境变量，用户将被要求设置密码');
  }
  if (config.debug) {
    console.log('调试模式已启用');
    console.log('配置:', { ...config, password: config.password ? '******' : '' });
  }
});
