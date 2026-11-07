/**
 * 本地构建辅助（不参与 Docker 构建）：拦截 Next 的 trace 文件写入。
 * 本机对 <distDir>/trace 的 open 调用会间歇性返回 EPERM 并导致构建中断，
 * 这里把该写入降级为内存黑洞，其余 I/O 不受影响。
 */
const fs = require('fs');
const { PassThrough } = require('stream');

const original = fs.createWriteStream;

fs.createWriteStream = function (file, options) {
  if (typeof file === 'string' && /(^|[\\/])trace$/.test(file)) {
    const sink = new PassThrough();
    sink.write = () => true;
    sink.end = (cb) => {
      if (typeof cb === 'function') cb();
    };
    return sink;
  }
  return original.apply(fs, arguments);
};
