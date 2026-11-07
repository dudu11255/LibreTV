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
 */
export const LEGACY_POLYFILLS = [
  '(function(){',
  'var w=typeof window!=="undefined"?window:this;',
  'if(typeof w.globalThis==="undefined"){try{w.globalThis=w}catch(e){}}',
  'if(typeof w.queueMicrotask!=="function"&&typeof Promise==="function"){',
  'w.queueMicrotask=function(fn){Promise.resolve().then(fn).catch(function(e){setTimeout(function(){throw e},0)})};}',
  'if(!Object.fromEntries){Object.fromEntries=function(it){var o={};if(!it)return o;',
  'if(typeof Symbol!=="undefined"&&it[Symbol.iterator]){var i=it[Symbol.iterator](),s;',
  'while(!(s=i.next()).done){o[s.value[0]]=s.value[1]}}else{for(var k in it){',
  'if(Object.prototype.hasOwnProperty.call(it,k))o[k]=it[k]}}return o};}',
  'if(!Object.hasOwn){Object.hasOwn=function(o,k){return Object.prototype.hasOwnProperty.call(o,k)};}',
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
  'if(!String.prototype.replaceAll){String.prototype.replaceAll=function(search,rep){',
  'var s=String(this);if(search instanceof RegExp){if(!search.global)throw new TypeError("replaceAll needs global RegExp");',
  'return s.replace(search,rep)}var t=String(search);if(t==="")return s;',
  'var parts=s.split(t),out=parts[0];for(var i=1;i<parts.length;i++){',
  'out+=(typeof rep==="function"?rep(t,s.indexOf(t)):String(rep))+parts[i]}return out};}',
  'if(typeof Promise==="function"&&!Promise.allSettled){Promise.allSettled=function(list){',
  'return Promise.all(Array.prototype.map.call(list,function(p){return Promise.resolve(p).then(',
  'function(v){return{status:"fulfilled",value:v}},function(e){return{status:"rejected",reason:e}})}))};}',
  'if(typeof w.WeakRef==="undefined"){w.WeakRef=function(o){this._v=o};',
  'w.WeakRef.prototype.deref=function(){return this._v};}',
  'if(typeof AbortSignal!=="undefined"&&typeof AbortController==="function"){',
  'if(!AbortSignal.timeout){AbortSignal.timeout=function(ms){var c=new AbortController();',
  'setTimeout(function(){var e;try{e=new DOMException("The operation timed out.","TimeoutError")}',
  'catch(x){e=new Error("The operation timed out.");e.name="TimeoutError"}c.abort(e)},ms);',
  'return c.signal};}',
  'if(!AbortSignal.any){AbortSignal.any=function(list){var c=new AbortController();',
  'function onAbort(){c.abort(this.reason)}',
  'for(var i=0;i<list.length;i++){var s=list[i];if(!s)continue;',
  'if(s.aborted){c.abort(s.reason);break}s.addEventListener("abort",onAbort)}',
  'return c.signal};}}',
  '})();',
].join('');
