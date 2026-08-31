// 代理鉴权模块
// 安全模式（服务端配置了 PROXY_SECRET 并注入 PROXY_TOKEN_MODE='1'）：
//   在密码校验通过后，用明文密码向 /api/proxy-token 换取服务端签名的短时效 token，
//   之后所有代理请求携带该 token。前端不再持有可被伪造的静态哈希。
//   为支持刷新后免重复输入，token 以短时效形式存入 localStorage。
// 兼容模式（未注入 PROXY_TOKEN_MODE）：回退为静态哈希（与旧部署一致）。
window.ProxyAuth = (function () {
    const TOKEN_KEY = 'proxyToken';
    let cachedToken = null;
    let cachedT = null;

    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(TOKEN_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data && data.token && data.t && (Date.now() - parseInt(data.t, 10)) < 9 * 60 * 1000) {
                cachedToken = data.token;
                cachedT = data.t;
            } else {
                localStorage.removeItem(TOKEN_KEY);
            }
        } catch (e) { /* 忽略 */ }
    }

    function saveToStorage() {
        try {
            if (cachedToken && cachedT) {
                localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: cachedToken, t: cachedT }));
            }
        } catch (e) { /* 忽略 */ }
    }

    loadFromStorage();

    // 密码校验通过后调用，向服务端换取短时效 token
    async function ensureToken(password) {
        if (!password) return;
        if (window.__ENV__ && window.__ENV__.PROXY_TOKEN_MODE !== '1') {
            // 服务端未启用 token 模式，无需获取
            return;
        }
        try {
            const resp = await fetch(`/api/proxy-token?password=${encodeURIComponent(password)}`);
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && data.success && data.token) {
                cachedToken = data.token;
                cachedT = data.t;
                saveToStorage();
            }
        } catch (e) {
            // 获取失败则回退到静态哈希鉴权
        }
    }

    function hasToken() {
        return !!(cachedToken && cachedT && (Date.now() - parseInt(cachedT, 10)) < 9 * 60 * 1000);
    }

    function addAuthToProxyUrl(url) {
        // 优先使用服务端签发的 token（安全模式）
        if (hasToken()) {
            const sep = url.includes('?') ? '&' : '?';
            return `${url}${sep}token=${cachedToken}&t=${cachedT}`;
        }
        // 兼容旧部署：使用页面中的静态哈希
        const currentPasswordHash = window.__ENV__ ? (window.__ENV__.PASSWORD || '') : '';
        if (!currentPasswordHash) return url;
        const sep = url.includes('?') ? '&' : '?';
        const timestamp = Date.now();
        return `${url}${sep}auth=${currentPasswordHash}&t=${timestamp}`;
    }

    return { addAuthToProxyUrl, ensureToken, hasToken };
})();
