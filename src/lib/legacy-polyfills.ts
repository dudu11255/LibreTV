/**
 * 电视端（老 Android WebView）运行时 API 补丁
 *
 * 语法降级解决「解析失败」，这里解决「解析通过但函数不存在」：
 * 产物里用到的 Object.fromEntries / hasOwn / Promise.allSettled /
 * Array.prototype.at / String.replaceAll / AbortSignal.timeout 等，
 * 在老内核上都是 undefined，一旦调用就中断首屏渲染。
 *
 * 以同步内联脚本注入 <head>：内联脚本解析到即执行、无下载等待，
 * 因此一定早于 Next 那些 async chunk 真正跑起来。必须保持纯 ES5。
 *
 * ⚠️ AbortController 是最要命的一个：@tanstack/query-core 的每次查询都会
 * 无条件 `new AbortController()`（不是懒加载），所以它缺失时**所有** useQuery
 * 都会同步抛错——表现为首页推荐「加载失败」、设置抽屉空、/api/status 也拿不到
 * 于是登录框永远不弹。这正是「接口在地址栏里能打开、页面上却全不正常」的成因。
 */
export const LEGACY_POLYFILLS = [
  '(function(){',
  'var w=typeof window!=="undefined"?window:this;',
  'var hasOwn=Object.prototype.hasOwnProperty;',
  'if(typeof w.globalThis==="undefined"){try{w.globalThis=w}catch(e){}}',
  'if(typeof w.queueMicrotask!=="function"&&typeof Promise==="function"){',
  'w.queueMicrotask=function(fn){Promise.resolve().then(fn).catch(function(e){setTimeout(function(){throw e},0)})};}',
  'if(!Object.fromEntries){Object.fromEntries=function(it){var o={};if(!it)return o;',
  'if(typeof Symbol!=="undefined"&&it[Symbol.iterator]){var i=it[Symbol.iterator](),s;',
  'while(!(s=i.next()).done){o[s.value[0]]=s.value[1]}}else{for(var k in it){',
  'if(hasOwn.call(it,k))o[k]=it[k]}}return o};}',
  'if(!Object.hasOwn){Object.hasOwn=function(o,k){return hasOwn.call(o,k)};}',
  'if(!Object.entries){Object.entries=function(o){var r=[];if(o==null)return r;',
  'for(var k in o){if(hasOwn.call(o,k))r.push([k,o[k]])}return r};}',
  'if(!Object.values){Object.values=function(o){var r=[];if(o==null)return r;',
  'for(var k in o){if(hasOwn.call(o,k))r.push(o[k])}return r};}',
  'if(!Array.prototype.includes){Array.prototype.includes=function(v,f){',
  'var n=this.length>>>0,i=Math.max(f===undefined?0:Math.trunc(Number(f))||0,0);',
  'for(;i<n;i++){var c=this[i];if(c===v||(c!==c&&v!==v))return true}return false};}',
  'if(!Array.prototype.find){Array.prototype.find=function(fn,t){var n=this.length>>>0;',
  'for(var i=0;i<n;i++){if(fn.call(t,this[i],i,this))return this[i]}return undefined};}',
  'if(!Array.prototype.findIndex){Array.prototype.findIndex=function(fn,t){var n=this.length>>>0;',
  'for(var i=0;i<n;i++){if(fn.call(t,this[i],i,this))return i}return -1};}',
  'if(!Array.prototype.flat){Array.prototype.flat=function(d){var out=[],dep=d===undefined?1:Number(d);',
  'function walk(a,n){for(var i=0;i<a.length;i++){if(i in a){var v=a[i];',
  'if(n>0&&Array.isArray(v))walk(v,n-1);else out.push(v)}}}walk(this,dep);return out};}',
  'if(!Array.prototype.flatMap){Array.prototype.flatMap=function(fn,t){var out=[];',
  'for(var i=0;i<this.length;i++){if(i in this){var v=fn.call(t,this[i],i,this);',
  'if(Array.isArray(v)){for(var j=0;j<v.length;j++)out.push(v[j])}else out.push(v)}}return out};}',
  'if(!Array.prototype.at){Array.prototype.at=function(n){var i=Math.trunc(Number(n))||0;',
  'if(i<0)i+=this.length;return i<0||i>=this.length?undefined:this[i]};}',
  'if(!String.prototype.at){String.prototype.at=function(n){var s=String(this);',
  'var i=Math.trunc(Number(n))||0;if(i<0)i+=s.length;return i<0||i>=s.length?undefined:s.charAt(i)};}',
  'if(!String.prototype.trimStart){String.prototype.trimStart=function(){',
  'return String(this).replace(/^\\s+/,"")};}',
  'if(!String.prototype.trimEnd){String.prototype.trimEnd=function(){',
  'return String(this).replace(/\\s+$/,"")};}',
  'if(!String.prototype.padStart){String.prototype.padStart=function(n,c){',
  'var s=String(this),len=n>>0;if(len<=s.length)return s;',
  'var pad=c===undefined?" ":String(c);if(!pad)return s;',
  'while(pad.length<len-s.length)pad+=pad;return pad.slice(0,len-s.length)+s};}',
  'if(!String.prototype.replaceAll){String.prototype.replaceAll=function(search,rep){',
  'var s=String(this);if(search instanceof RegExp){if(!search.global)throw new TypeError("replaceAll needs global RegExp");',
  'return s.replace(search,rep)}var t=String(search);if(t==="")return s;',
  'var parts=s.split(t),out=parts[0];for(var i=1;i<parts.length;i++){',
  'out+=(typeof rep==="function"?rep(t,s.indexOf(t)):String(rep))+parts[i]}return out};}',
  'if(typeof Promise==="function"&&!Promise.allSettled){Promise.allSettled=function(list){',
  'return Promise.all(Array.prototype.map.call(list,function(p){return Promise.resolve(p).then(',
  'function(v){return{status:"fulfilled",value:v}},function(e){return{status:"rejected",reason:e}})}))};}',
  'if(typeof Promise==="function"&&!Promise.prototype.finally){Promise.prototype.finally=function(fn){',
  'var P=this.constructor||Promise;return this.then(function(v){return P.resolve(fn&&fn()).then(function(){return v})},',
  'function(e){return P.resolve(fn&&fn()).then(function(){throw e})})};}',
  'if(!Number.isFinite){Number.isFinite=function(v){return typeof v==="number"&&isFinite(v)};}',
  'if(!Number.isInteger){Number.isInteger=function(v){return typeof v==="number"&&isFinite(v)&&Math.floor(v)===v};}',
  'if(typeof w.WeakRef==="undefined"){w.WeakRef=function(o){this._v=o};',
  'w.WeakRef.prototype.deref=function(){return this._v};}',
  // —— ResizeObserver：老内核没有，用空实现兜住（只是失去「尺寸变化后重算」的能力）
  'if(typeof w.ResizeObserver!=="function"){w.ResizeObserver=function(){this.observe=function(){};',
  'this.unobserve=function(){};this.disconnect=function(){}};}',
  // —— AbortController / AbortSignal：query-core 无条件 new，缺了全站查询全废
  //   信号对象打 __ltPolyfill 标记，下面 fetch 包装据此决定要不要丢掉 signal
  'var ltFakeSignal=false;',
  'if(typeof w.AbortController!=="function"){',
  'function LTSignal(){this.aborted=false;this.reason=undefined;this.onabort=null;this._l=[];}',
  'LTSignal.prototype.__ltPolyfill=true;',
  'LTSignal.prototype.addEventListener=function(t,fn){if(t==="abort"&&typeof fn==="function")this._l.push(fn)};',
  'LTSignal.prototype.removeEventListener=function(t,fn){var i=this._l.indexOf(fn);if(i>=0)this._l.splice(i,1)};',
  'LTSignal.prototype.throwIfAborted=function(){if(this.aborted)throw this.reason;};',
  'LTSignal.prototype._ltFire=function(){var e={type:"abort",target:this},i;',
  'for(i=0;i<this._l.length;i++){try{this._l[i].call(this,e)}catch(x){}}',
  'if(typeof this.onabort==="function"){try{this.onabort(e)}catch(x){}}};',
  // 用 try 包住全局赋值：个别环境下这些属性是只读的，赋值失败不能让整个补丁中断
  'try{if(typeof w.AbortSignal!=="function")w.AbortSignal=LTSignal;}catch(e){}',
  'var LTController=function(){this.signal=new LTSignal();};',
  'LTController.prototype.abort=function(r){var s=this.signal;if(s.aborted)return;',
  's.aborted=true;s.reason=r===undefined?new Error("Aborted"):r;s._ltFire();};',
  'try{w.AbortController=LTController;ltFakeSignal=true;}catch(e){}',
  '}',
  'try{',
  'if(typeof AbortSignal!=="undefined"){',
  'if(!AbortSignal.timeout){AbortSignal.timeout=function(ms){var c=new w.AbortController();',
  'setTimeout(function(){var e;try{e=new DOMException("The operation timed out.","TimeoutError")}',
  'catch(x){e=new Error("The operation timed out.");e.name="TimeoutError"}c.abort(e)},ms);',
  'return c.signal};}',
  'if(!AbortSignal.any){AbortSignal.any=function(list){var c=new w.AbortController();',
  'function onAbort(){c.abort(this.reason)}',
  'for(var i=0;i<list.length;i++){var s=list[i];if(!s)continue;',
  'if(s.aborted){c.abort(s.reason);break}s.addEventListener("abort",onAbort)}',
  'return c.signal};}}',
  '}catch(e){}',
  // 兜住的 signal 不是原生对象，直接交给 fetch 会抛 TypeError；
  // 老内核本来就没有取消能力，丢掉 signal = 「能正常请求、只是不能取消」
  'if(ltFakeSignal&&typeof w.fetch==="function"){',
  'var ltFetch=w.fetch;',
  'w.fetch=function(input,init){',
  'if(init&&init.signal&&init.signal.__ltPolyfill){var c={},k;',
  'for(k in init){if(k!=="signal"&&hasOwn.call(init,k))c[k]=init[k];}init=c;}',
  'return ltFetch.call(w,input,init);};',
  '}',
  '})();',
].join('');
