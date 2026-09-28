/* eslint-disable @typescript-eslint/no-explicit-any -- mux.js 无完整类型定义 */
// @ts-expect-error - mux.js 没有完整的 TypeScript 类型定义
import muxjs from 'mux.js';

/**
 * MP4 转封装（基于 mux.js，借鉴 MoonTV mp4-transmuxer）。
 *
 * HLS 的 TS 分片对浏览器不可直接播放，下载产物要做 TS→fMP4 转封装：
 * mux.js 的 Transmuxer 每次 flush 产出一段 fMP4（首次含 initSegment），
 * 因此可以边下载边流式写入文件，不需要把整集聚合在内存里。
 */

export class StreamingTransmuxer {
  private transmuxer: any;
  private writer?: { write(data: Uint8Array): Promise<void>; close?(): Promise<void>; abort?(): Promise<void> };
  private initWritten = false;
  private segmentCount = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private writeError: Error | undefined;

  constructor(writer?: { write(data: Uint8Array): Promise<void> }) {
    this.writer = writer;
    this.transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: true });
    this.transmuxer.on('data', (segment: any) => {
      const data: Uint8Array = this.initWritten
        ? new Uint8Array(segment.data)
        : concatInitAndData(segment);
      this.initWritten = true;
      this.segmentCount += 1;
      // 写入串行化：写失败暂存，下一次 pushAndTransmux 时抛出
      this.writeChain = this.writeChain.then(() => this.writer?.write(data));
      this.writeChain.catch((err) => {
        this.writeError = err instanceof Error ? err : new Error(String(err));
      });
    });
  }

  setWriter(writer: { write(data: Uint8Array): Promise<void>; close?(): Promise<void>; abort?(): Promise<void> }): void {
    this.writer = writer;
  }

  getSegmentCount(): number {
    return this.segmentCount;
  }

  /** push 一个 TS 分片并立刻 flush 出 fMP4 片段 */
  async pushAndTransmux(tsData: Uint8Array): Promise<void> {
    this.transmuxer.push(tsData);
    this.transmuxer.flush();
    await this.writeChain;
    if (this.writeError) {
      const err = this.writeError;
      this.writeError = undefined;
      throw err;
    }
  }

  /** 收尾：最后一次 flush 并关闭写入流 */
  async finish(): Promise<void> {
    this.transmuxer.flush();
    await this.writeChain;
    await this.writer?.close?.();
  }

  async abort(): Promise<void> {
    try {
      await this.writer?.abort?.();
    } catch { /* 忽略 */ }
  }
}

function concatInitAndData(segment: { initSegment: ArrayBuffer; data: ArrayBuffer }): Uint8Array {
  const init = new Uint8Array(segment.initSegment);
  const data = new Uint8Array(segment.data);
  const out = new Uint8Array(init.length + data.length);
  out.set(init, 0);
  out.set(data, init.length);
  return out;
}

/** 批量转封装：push 全部分片后一次 flush，聚合为 MP4 Blob（内存型，适合小体量） */
export function transmuxTSToMP4(tsSegments: Uint8Array[], duration?: number): Blob {
  const transmuxer = new muxjs.mp4.Transmuxer({
    keepOriginalTimestamps: true,
    ...(duration ? { duration } : {}),
  });
  const chunks: Uint8Array[] = [];
  let initWritten = false;
  transmuxer.on('data', (segment: any) => {
    if (!initWritten) {
      chunks.push(new Uint8Array(segment.initSegment));
      initWritten = true;
    }
    chunks.push(new Uint8Array(segment.data));
  });
  for (const ts of tsSegments) transmuxer.push(ts);
  transmuxer.flush();
  return new Blob(chunks.map((c) => c.buffer as ArrayBuffer), { type: 'video/mp4' });
}
