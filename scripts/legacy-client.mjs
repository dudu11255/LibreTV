/**
 * 构建后语法降级（电视端兼容）
 *
 * Next.js 15 固定使用较新的编译目标（约 Chrome 111），产物里会保留可选链 `?.`、
 * 空值合并 `??`、逻辑赋值 `??=`、class 私有字段 `#x` 等语法。
 * 电视端浏览器（TV Bro 等）跑在系统 Android WebView 上，内核常停留在 Chromium 70-90
 * 且无法升级，解析到这些语法会直接抛 SyntaxError，导致整个 chunk 不执行 —— 表现就是白屏。
 *
 * 这里在 `next build` 之后，用 esbuild 对客户端产物再做一次 downlevel（目标 ES2017）。
 *
 * 为什么不用 TypeScript 的 transpileModule（v3.0.0 的初版做法）：
 * TS 在降级 class 私有字段时，会把「未初始化私有字段」的 WeakMap 写入（`_x.set(this, void 0)`）
 * 提到构造函数体**最前面**，在 `super()` 之前执行。派生类构造函数里访问 `this` 之前必须先
 * super()，于是 @tanstack/query-core 的 FocusManager（`class extends Subscribable { #setup = ... }`）
 * 一构造就抛 ReferenceError: Must call super constructor ...，整站直接落到 global-error。
 * esbuild 的私有字段降级严格排在 super() 之后，语义正确。
 *
 * 注意：`/_next/static` 的响应头是 `immutable` + 一年缓存，若只改内容不改文件名，
 * 装过旧版本的电视会继续命中缓存里的坏文件、修复看起来「没生效」。所以降级过的 chunk
 * 会带新后缀重命名，并把 .next 下所有引用一起改写。
 *
 * 重命名有个坑（v3.0.3 踩过）：webpack runtime 里动态 chunk 的文件名不是完整字符串，
 * 而是 `"static/chunks/" + ({id:"<name>"}[id]) + "." + ({id:"<hash>"}[id]) + ".js"`
 * 现拼出来的。完整文件名在 runtime 源码里根本不存在，所以「按整份文件名做字符串替换」
 * 永远改不到它 —— 文件改成了 `.lgXXXX.js`，runtime 仍拼旧名，所有 `next/dynamic`
 * 的 chunk 一律 404（前端表现就是 ChunkLoadError / 播放器永远转圈）。
 * 因此重命名后必须走 patchRuntimeChunkMaps() 补改哈希表，再用 verify() 把结果
 * 跟磁盘实际文件对一遍 —— 对不上就让构建失败，而不是把坏产物推上线。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const DIST_DIR = process.env.NEXT_DIST_DIR || '.next';
const DIST_PATH = path.join(process.cwd(), DIST_DIR);
const STATIC_DIR = path.join(DIST_PATH, 'static');

/** 递归列出目录下所有文件 */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 产物里是否还残留需要降级的语法（`?.`/`??` 也可能是正则或三元里的数字，交给转换器处理即可） */
function needsDownlevel(code) {
  return (
    code.includes('?.') ||
    code.includes('??') ||
    code.includes('&&=') ||
    code.includes('||=') ||
    // catch{} 可选捕获绑定是 ES2019（Chrome 66+），老内核会解析失败
    /\}\s*catch\s*\{/.test(code) ||
    /(^|[^\w$])#[A-Za-z_$][\w$]*\s*[=;(]/.test(code)
  );
}

/** BigInt 字面量（`255n`）是 ES2020，Chrome 67 以下直接解析失败；转成 BigInt(255) 调用，
 *  老内核至少不会整个文件崩掉（真要执行到这段才会报运行时错）。
 *  同时在 ES2017 目标下 esbuild 会因 BigInt 字面量直接报错，所以必须在转换前先替换掉。 */
function downlevelBigInt(code) {
  return code.replace(/([&|^<>+\-*/%\s(,])(\d{1,4})n(?=[\s),;\]])/g, (_m, pre, num) => `${pre}BigInt(${num})`);
}

/**
 * 降级单个 chunk。target ES2017 = 降掉可选链/空值合并/逻辑赋值/私有字段/class 字段，
 * 保留原生 async/await（Chrome 55+ 即可）。
 * - charset utf8：默认 ascii 会把中文转成 \uXXXX，体积白白变大
 * - minifyWhitespace：只压空白不压语义，避免重新排版把 1.6MB 产物顶到 2.3MB
 */
function downlevel(code) {
  return transformSync(code, {
    loader: 'js',
    target: 'es2017',
    charset: 'utf8',
    minifyWhitespace: true,
    legalComments: 'inline',
    sourcefile: 'chunk.js',
  }).code;
}

/** webpack runtime 中 `r.u` 的拼装表达式（flat 对象字面量，无嵌套） */
const U_FN_PATTERN =
  /"static\/chunks\/"\+\(\((\{[^{}]*\})\)\[(\w+)\]\|\|\2\)\+"\."\+\((\{[^{}]*\})\)\[(\w+)\]\+"\.js"/g;

/** 解析 `{123:"abc",456:"def"}` 形式的映射表 */
function parseChunkMap(text) {
  const map = new Map();
  for (const m of text.matchAll(/(\d+):"([^"]*)"/g)) map.set(m[1], m[2]);
  return map;
}

/** 列出客户端 webpack runtime 文件（chunk 文件名拼装逻辑只在这里；server/ 下的不参与降级，不检查） */
function runtimeFiles() {
  return walk(STATIC_DIR).filter((f) => /[/\\]webpack-[\w.-]*\.js$/.test(f));
}

/**
 * 改写 runtime 里「chunk id -> 内容哈希」映射表，让拼出来的文件名指向降级后的新文件。
 *
 * 例：`9910:"e8ddd09611a6c98d"` -> `9910:"e8ddd09611a6c98d.lg67f70e8d"`
 * 拼装结果是 `a4634e51.e8ddd09611a6c98d.lg67f70e8d.js`，与磁盘上的文件名一致。
 * 只匹配带引号的哈希串，避免误伤已经整名替换过的引用（那里哈希前是 `.` 不是 `"`）。
 */
function patchRuntimeChunkMaps(renames) {
  // 收集「旧哈希 -> 追加后缀」，仅限 `.lgXXXX` 追加式改名
  const patches = [];
  for (const [oldName, newName] of renames) {
    const oldBase = oldName.replace(/\.js$/, '');
    const newBase = newName.replace(/\.js$/, '');
    const dot = oldBase.indexOf('.');
    if (dot < 0 || !newBase.startsWith(oldBase)) continue;
    patches.push({ hash: oldBase.slice(dot + 1), suffix: newBase.slice(oldBase.length) });
  }
  if (!patches.length) return 0;

  let patched = 0;
  for (const file of runtimeFiles()) {
    let content = fs.readFileSync(file, 'utf8');
    let hit = false;
    for (const { hash, suffix } of patches) {
      const needle = `"${hash}"`;
      if (!content.includes(needle)) continue;
      content = content.split(needle).join(`"${hash}${suffix}"`);
      hit = true;
    }
    if (hit) {
      fs.writeFileSync(file, content);
      patched++;
    }
  }
  return patched;
}

/**
 * 构建后自检：把 runtime 拼出来的每个 chunk URL、以及 HTML/RSC/manifest 里出现的
 * /static/chunks/*.js 引用，逐一对照磁盘文件。缺一个就退出码 1 —— 宁可构建失败，
 * 也不要把「一进播放页就 ChunkLoadError」的镜像推上去。
 */
function verify() {
  const problems = [];
  let checked = 0;

  // 1) runtime 动态拼装出来的文件名
  for (const file of runtimeFiles()) {
    const rel = path.relative(DIST_PATH, file);
    const src = fs.readFileSync(file, 'utf8');
    let matched = false;
    for (const m of src.matchAll(U_FN_PATTERN)) {
      matched = true;
      const nameMap = parseChunkMap(m[1]);
      const hashMap = parseChunkMap(m[3]);
      for (const [id, hash] of hashMap) {
        const name = nameMap.get(id) || id;
        const target = path.join(DIST_PATH, 'static', 'chunks', `${name}.${hash}.js`);
        checked++;
        if (!fs.existsSync(target)) {
          problems.push(`${rel} 拼出 static/chunks/${name}.${hash}.js，磁盘上不存在`);
        }
      }
    }
    if (!matched) {
      console.warn(`[legacy] 跳过自检：${rel} 里没找到认识的 chunk 拼装表达式（webpack 版本可能变了）`);
    }
  }

  // 2) HTML / RSC / manifest 中的静态引用
  const TEXT = /\.(html|rsc|json)$/;
  for (const file of walk(DIST_PATH)) {
    if (file.includes(`${path.sep}cache${path.sep}`) || !TEXT.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/static\/chunks\/[\w.\-/]+\.js/g)) {
      const ref = m[0];
      // 跳过模板占位符（如 [id].js）之类的非实体引用
      if (/[[\]{}?]/.test(ref)) continue;
      checked++;
      if (!fs.existsSync(path.join(DIST_PATH, ref))) {
        problems.push(`${path.relative(DIST_PATH, file)} 引用了 ${ref}，磁盘上不存在`);
      }
    }
  }

  if (problems.length) {
    const list = [...new Set(problems)].slice(0, 10);
    console.error(`[legacy] 自检失败：${problems.length} 处引用指向不存在的文件`);
    for (const p of list) console.error(`  - ${p}`);
    console.error('[legacy] 大概率是降级改名后引用没改全；请检查本脚本的改写逻辑，不要直接上线。');
    process.exit(1);
  }

  console.log(`[legacy] 自检通过：${checked} 处 chunk 引用全部命中磁盘文件`);
}

function main() {
  if (!fs.existsSync(STATIC_DIR)) {
    console.error('[legacy] 未找到 .next/static，请先执行 next build');
    process.exit(1);
  }

  const files = walk(STATIC_DIR).filter((f) => f.endsWith('.js'));
  const renames = new Map();
  let touched = 0;
  let beforeBytes = 0;
  let afterBytes = 0;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const pre = downlevelBigInt(src);
    if (!needsDownlevel(pre) && pre === src) continue;

    let out;
    try {
      out = downlevelBigInt(downlevel(pre));
    } catch (err) {
      console.error(`[legacy] 降级失败：${path.relative(DIST_PATH, file)}\n${err.message}`);
      process.exit(1);
    }
    if (!out || out === src) continue;

    // 内容变了就换文件名，绕开 immutable 缓存（见文件头说明）
    const oldName = path.basename(file);
    const suffix = crypto.createHash('sha256').update(out).digest('hex').slice(0, 8);
    const newName = oldName.replace(/\.js$/, `.lg${suffix}.js`);
    fs.writeFileSync(path.join(path.dirname(file), newName), out);
    fs.unlinkSync(file);
    renames.set(oldName, newName);

    touched++;
    beforeBytes += Buffer.byteLength(src);
    afterBytes += Buffer.byteLength(out);
  }

  // 把 .next 下所有引用（HTML、RSC、manifest、webpack runtime）里的旧文件名改掉
  let rewritten = 0;
  if (renames.size) {
    const TEXT = /\.(js|html|rsc|json|txt)$/;
    for (const file of walk(DIST_PATH)) {
      if (file.includes(`${path.sep}cache${path.sep}`) || !TEXT.test(file)) continue;
      let content = fs.readFileSync(file, 'utf8');
      let hit = false;
      for (const [oldName, newName] of renames) {
        if (content.includes(oldName)) {
          content = content.split(oldName).join(newName);
          hit = true;
        }
      }
      if (hit) {
        fs.writeFileSync(file, content);
        rewritten++;
      }
    }
  }

  // runtime 里 chunk 文件名是拼出来的，整名替换覆盖不到，单独补
  const patchedRuntimes = renames.size ? patchRuntimeChunkMaps(renames) : 0;

  const delta = beforeBytes ? ((afterBytes - beforeBytes) / beforeBytes) * 100 : 0;
  console.log(
    `[legacy] 已降级 ${touched}/${files.length} 个客户端 chunk，` +
      `体积 ${(beforeBytes / 1024).toFixed(1)}KB -> ${(afterBytes / 1024).toFixed(1)}KB (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)，` +
      `改写引用 ${rewritten} 个文件，runtime 映射表 ${patchedRuntimes} 个`
  );

  verify();
}

main();
