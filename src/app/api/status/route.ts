import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader } from '@/lib/auth';
import { getEnvSources } from '@/lib/env-sources';

export const runtime = 'nodejs';

/** 站点状态：客户端据此决定是否弹出登录框 / 提示管理员配置密码，并获取预置采集站 */
export async function GET(req: Request) {
  const passwordRequired = isPasswordConfigured();
  const verified = passwordRequired && sessionFromCookieHeader(req.headers.get('cookie'));
  return NextResponse.json({
    passwordRequired,
    verified,
    // 构建时由 next.config.ts 从 package.json 注入
    version: process.env.APP_VERSION || 'dev',
    // 部署者通过 DEFAULT_SOURCES 预置的采集站
    defaultSources: getEnvSources(),
  });
}
