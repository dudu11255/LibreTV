/**
 * 电视端自检记录器（内联 ES5，注入 <head> 且早于所有打包 chunk）
 *
 * 为什么需要它：电视/投影仪上的 TV Bro 没有控制台，出了问题只能看到「加载失败」四个字，
 * 完全不知道是没发请求、发了没人答、还是 401。这里在最早的时刻把三类信息记进
 * window.__LT_DIAG，由 DiagPanel 在屏幕上渲染出来：
 *   - 未捕获异常 / Promise 拒绝 / 资源加载失败
 *   - fetch 的非 2xx 响应（状态码 + 耗时）
 *   - fetch 的传输层失败（网络错误 / 被拦 / 抛异常）
 *
 * 只记异常项，成功的请求不记，避免面板被正常流量刷满。
 *
 * 另外还带一个「启动看门狗」：如果 12 秒后 React 还没挂载（Providers 会写
 * <html data-lt-ready="1">），就不再指望 ?diag=1 那个 React 面板，直接用原生 DOM
 * 铺一层说明 + 已记录的异常。这样「脚本整段没跑」和「脚本跑了但接口 401」在电视上
 * 能一眼区分开——这两种情况的修法完全不同。
 *
 * 必须保持纯 ES5：老 WebView 解析到即执行，语法新一点就整个脚本失效。
 */
export const DIAG_RECORDER = [
  '(function(){',
  'var w=window;var d={events:[],start:new Date().getTime()};w.__LT_DIAG=d;',
  'function push(t,m,ms){try{if(d.events.length>80)d.events.shift();',
  'd.events.push({t:t,m:String(m).slice(0,220),ms:ms||0,at:new Date().getTime()-d.start});}catch(e){}}',
  'd.push=push;',
  'w.addEventListener("error",function(e){',
  'var t=e&&e.target;',
  'if(t&&t!==w&&(t.src||t.href)){push("res",(t.src||t.href)+" 加载失败");return}',
  'push("err",(e&&e.message||"脚本错误")+" @"+String(e&&e.filename||"").slice(-46)+":"+(e&&e.lineno||0));',
  '},true);',
  'w.addEventListener("unhandledrejection",function(e){',
  'var r=e&&e.reason;var m=r&&(r.name?r.name+": ":"")+(r.message||r);',
  'push("rej",m||"未处理的 Promise 拒绝");',
  '});',
  'w.addEventListener("offline",function(){push("evt","浏览器报告离线（offline 事件）")});',
  'w.addEventListener("online",function(){push("evt","浏览器报告在线（online 事件）")});',
  'if(w.fetch){',
  'var orig=w.fetch;',
  'w.fetch=function(input,init){',
  'var url="";try{url=typeof input==="string"?input:(input&&input.url)||""}catch(e){}',
  'var t0=new Date().getTime();',
  'function ms(){return new Date().getTime()-t0}',
  'var p;',
  'try{p=orig.apply(w,arguments)}catch(err){push("net",url+" 同步抛错 "+String(err&&err.message||err));throw err}',
  'return p.then(function(res){',
  'try{if(!res.ok)push("http",res.status+" "+res.statusText+" "+url,ms())}catch(e){}',
  'return res;',
  '},function(err){',
  'push("net",url+" 未送达 "+String(err&&(err.name+": ")+(err.message||"")||err),ms());',
  'throw err;',
  '});',
  '};',
  '}',
  // —— 启动看门狗：React 迟迟没挂载时，用纯 DOM 把原因铺到屏幕上 ——
  'function mk(tag,css,text){var n=document.createElement(tag);',
  'if(css)n.setAttribute("style",css);if(text!=null)n.appendChild(document.createTextNode(String(text)));return n;}',
  'function showBootWarn(){',
  'try{',
  'if(!document.body)return;',
  'if(document.getElementById("lt-boot-warn"))return;',
  'if(document.documentElement.getAttribute("data-lt-ready")==="1")return;',
  'var box=mk("div","position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;',
  'background:#0b101a;color:#e6edf3;font:14px/1.7 sans-serif;padding:20px;overflow:auto;-webkit-overflow-scrolling:touch;");',
  'box.id="lt-boot-warn";',
  'box.appendChild(mk("div","font-size:17px;font-weight:700;margin-bottom:10px;","页面脚本没有正常运行"));',
  'box.appendChild(mk("div","color:#9aa7b8;margin-bottom:12px;",',
  '"这不是密码/登录问题：浏览器的脚本没跑起来，所以按钮、推荐、设置都不会有反应。把下面这段内容拍照发给开发者即可定位。"));',
  'box.appendChild(mk("div","color:#9aa7b8;word-break:break-all;margin-bottom:12px;","UA " + (navigator.userAgent||"").slice(0,170)));',
  'var evs=d.events.slice(-12).reverse();',
  'if(evs.length===0){',
  'box.appendChild(mk("div","color:#ffb454;margin-bottom:12px;",',
  '"没有捕获到脚本错误：多数是这个浏览器内核太旧，缺少 Promise / AbortController 等基础能力，或脚本被拦下载。"));',
  '}else{',
  'box.appendChild(mk("div","font-weight:600;margin-bottom:6px;","最近的异常（新的在上）"));',
  'var ul=mk("div","margin-bottom:12px;");',
  'for(var i=0;i<evs.length;i++){',
  'var e=evs[i];',
  'ul.appendChild(mk("div","margin-bottom:4px;word-break:break-all;font-size:12px;color:#c9d4e3;",',
  '"["+e.t+"] "+e.m));',
  '}',
  'box.appendChild(ul);',
  '}',
  'var btn=mk("button","margin-top:6px;padding:10px 18px;border:0;border-radius:8px;',
  'background:#23ade5;color:#04121b;font-size:15px;font-weight:600;","重新加载");',
  'btn.onclick=function(){try{w.location.reload()}catch(e){}};',
  'box.appendChild(btn);',
  'var close=mk("button","margin:6px 0 0 10px;padding:10px 18px;border:1px solid #33415a;',
  'border-radius:8px;background:transparent;color:#c9d4e3;font-size:15px;","先关掉");',
  'close.onclick=function(){try{box.parentNode.removeChild(box)}catch(e){}};',
  'box.appendChild(close);',
  'document.body.appendChild(box);',
  '}catch(e){}',
  '}',
  'd.showBootWarn=showBootWarn;',
  'setTimeout(showBootWarn,12000);',
  '})();',
].join('');
