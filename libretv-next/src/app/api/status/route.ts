import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader } from '@/lib/auth';

export const runtime = 'nodejs';

/** 站点状态：客户端据此决定是否弹出登录框 / 提示管理员配置密码 */
export async function GET(req: Request) {
  const passwordRequired = isPasswordConfigured();
  const verified = passwordRequired && sessionFromCookieHeader(req.headers.get('cookie'));
  return NextResponse.json({
    passwordRequired,
    verified,
    version: '2.0.0',
  });
}
