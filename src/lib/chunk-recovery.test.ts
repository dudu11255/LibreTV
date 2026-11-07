import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './chunk-recovery';

describe('isChunkLoadError', () => {
  it('识别 webpack 的 ChunkLoadError（本次线上故障的形态）', () => {
    const err = new Error(
      'Loading chunk 9910 failed.\n(error: http://192.168.112.227:10001/_next/static/chunks/a4634e51.e8ddd09611a6c98d.js)'
    );
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('按 name 识别，不依赖文案（不同浏览器/内核文案不一）', () => {
    const err = new Error('whatever');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('识别原生动态 import 失败', () => {
    expect(
      isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /_next/x.js'))
    ).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('普通渲染异常不算（不能误触发整页刷新）', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of null (reading 'map')"))).toBe(
      false
    );
    expect(isChunkLoadError(new Error('Loading data failed'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('boom')).toBe(false);
  });
});
