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
  '})();',
].join('');
