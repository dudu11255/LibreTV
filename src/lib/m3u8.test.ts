import { describe, expect, it } from 'vitest';
import { filterAdsFromM3u8, isProxiedUri, rewriteM3u8 } from './m3u8';

const BASE = 'https://cdn.example.com/live/index.m3u8';

describe('rewriteM3u8', () => {
  it('把分片、嵌套播放列表、key、map 全部改写为代理地址（查询串形式）', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1280000',
      'https://cdn.example.com/live/720p.m3u8',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin",IV=0x1',
      '#EXT-X-MAP:URI="init.mp4"',
      '/relative/seg1.ts',
      'seg2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const out = rewriteM3u8(input, BASE);

    expect(out).toContain('/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/live/720p.m3u8'));
    expect(out).toContain('/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/key.bin'));
    expect(out).toContain('/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/live/init.mp4'));
    expect(out).toContain('/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/relative/seg1.ts'));
    expect(out).toContain('/api/proxy?url=' + encodeURIComponent('https://cdn.example.com/live/seg2.ts'));
    // 非地址行保持不变
    expect(out).toContain('#EXTM3U');
    expect(out).toContain('#EXT-X-ENDLIST');
  });

  it('直播前缀改写为 /api/live/stream?url= 形式', () => {
    const out = rewriteM3u8('https://cdn.example.com/live/seg1.ts', BASE, 0, '/api/live/stream?url=');
    expect(out).toBe('/api/live/stream?url=' + encodeURIComponent('https://cdn.example.com/live/seg1.ts'));
  });

  it('已是代理地址的行（新旧两种形式）不重复改写', () => {
    const legacy = '/api/proxy/' + encodeURIComponent('https://x.com/a.ts');
    expect(rewriteM3u8(legacy, BASE)).toBe(legacy);
    const modern = '/api/proxy?url=' + encodeURIComponent('https://x.com/a.ts');
    expect(rewriteM3u8(modern, BASE)).toBe(modern);
    const legacyLive = '/api/live/stream/' + encodeURIComponent('https://x.com/live.m3u8');
    expect(rewriteM3u8(legacyLive, BASE, 0, '/api/live/stream?url=')).toBe(legacyLive);
  });

  it('超过递归深度限制时原样返回', () => {
    const input = 'https://a.ts';
    expect(rewriteM3u8(input, BASE, 6)).toBe(input);
  });
});

describe('isProxiedUri', () => {
  it('新旧两种代理形式均识别', () => {
    expect(isProxiedUri('/api/proxy/' + encodeURIComponent('https://x.com/a.ts'))).toBe(true);
    expect(isProxiedUri('/api/proxy?url=' + encodeURIComponent('https://x.com/a.ts'))).toBe(true);
    expect(isProxiedUri('/api/live/stream?url=' + encodeURIComponent('https://x.com/live.m3u8'))).toBe(true);
    expect(isProxiedUri('https://cdn.example.com/seg1.ts')).toBe(false);
    expect(isProxiedUri('/relative/seg1.ts')).toBe(false);
  });
});

describe('filterAdsFromM3u8', () => {
  it('剔除 DISCONTINUITY 标记，保留其余内容', () => {
    const input = ['#EXTM3U', '#EXT-X-DISCONTINUITY', 'ad.ts', '#EXTINF:10,', 'video.ts', '#EXT-X-DISCONTINUITY'].join('\n');
    const out = filterAdsFromM3u8(input);
    expect(out).not.toContain('#EXT-X-DISCONTINUITY');
    expect(out).toContain('video.ts');
  });

  it('空内容返回空串', () => {
    expect(filterAdsFromM3u8('')).toBe('');
  });
});
