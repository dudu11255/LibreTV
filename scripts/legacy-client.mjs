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

  const delta = beforeBytes ? ((afterBytes - beforeBytes) / beforeBytes) * 100 : 0;
  console.log(
    `[legacy] 已降级 ${touched}/${files.length} 个客户端 chunk，` +
      `体积 ${(beforeBytes / 1024).toFixed(1)}KB -> ${(afterBytes / 1024).toFixed(1)}KB (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)，` +
      `改写引用 ${rewritten} 个文件`
  );
}

main();
