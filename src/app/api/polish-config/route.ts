import { NextRequest, NextResponse } from 'next/server';
import { getClientSafePolishConfig } from '@/lib/utils/polishConfigLoader';

/**
 * GET /api/polish-config
 * 获取润色配置信息（客户端安全版本）
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[Polish Config API] 接收到配置请求', {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent')?.slice(0, 100)
    });

    const config = getClientSafePolishConfig();

    console.log('[Polish Config API] 成功返回配置', {
      totalGoals: config.polish_goals.length,
      configVersion: config.config_info.version,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json(config, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300' // 缓存5分钟
      }
    });

  } catch (error) {
    console.error('[Polish Config API] 获取配置失败:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to load polish configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 