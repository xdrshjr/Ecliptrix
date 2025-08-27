import { NextRequest, NextResponse } from 'next/server';

// Backend service URL
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// Logging functions
const logRequest = (data: any) => {
  console.log(`[Audio Search API] Request received:
  - Query: "${data.query}"
  - Max audios: ${data.max_audios}
  - Duration min: ${data.duration_min || 'none'}
  - Duration max: ${data.duration_max || 'none'}
  - Audio type: ${data.audio_type || 'all'}`);
};

const logResponse = (success: boolean, count?: number, error?: string) => {
  if (success && count !== undefined) {
    console.log(`[Audio Search API] Search successful: ${count} audio files found`);
  } else {
    console.log(`[Audio Search API] Search failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, max_audios = 20, duration_min, duration_max, audio_type = 'all', sort_by = 'score' } = body;

    // Validate request parameters
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      console.error('[Audio Search API] Invalid request: query is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Search query is required',
          audios: [],
          total_found: 0,
          query: query || ''
        },
        { status: 400 }
      );
    }

    if (max_audios < 1 || max_audios > 50) {
      console.error('[Audio Search API] Invalid request: max_audios must be between 1 and 50');
      return NextResponse.json(
        { 
          success: false,
          message: 'max_audios must be between 1 and 50',
          audios: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    // Validate sort_by parameter
    const validSortOptions = ['score', 'downloads', 'rating', 'duration_desc', 'duration_asc', 'created_desc', 'created_asc'];
    if (!validSortOptions.includes(sort_by)) {
      console.error('[Audio Search API] Invalid request: invalid sort_by parameter');
      return NextResponse.json(
        { 
          success: false,
          message: `sort_by must be one of: ${validSortOptions.join(', ')}`,
          audios: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    // Validate duration range if both are provided
    if (duration_min !== undefined && duration_max !== undefined && duration_min >= duration_max) {
      console.error('[Audio Search API] Invalid request: duration_min must be less than duration_max');
      return NextResponse.json(
        { 
          success: false,
          message: 'duration_min must be less than duration_max',
          audios: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    console.log(`[Audio Search API] Processing request:`, {
      query: query.trim(),
      max_audios,
      duration_min,
      duration_max,
      audio_type,
      sort_by
    });

    // Call backend service
    const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/api/audio/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query.trim(),
        max_audios,
        duration_min,
        duration_max,
        audio_type,
        sort_by
      }),
    });

    console.log(`[Audio Search API] Backend response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Audio Search API] Backend error: ${response.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${response.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Backend service error',
          audios: [],
          total_found: 0,
          query: query
        },
        { status: 500 }
      );
    }

    const result = await response.json();
    
    // Validate backend response format
    if (!result || typeof result.success !== 'boolean') {
      console.error('[Audio Search API] Invalid backend response format');
      logResponse(false, undefined, 'Invalid backend response format');
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Invalid response from backend service',
          audios: [],
          total_found: 0,
          query: query
        },
        { status: 500 }
      );
    }

    logResponse(result.success, result.audios?.length, result.message);

    // Return result, ensuring format consistency
    return NextResponse.json({
      success: result.success,
      message: result.message || (result.success ? 'Search completed' : 'Search failed'),
      audios: result.audios || [],
      total_found: result.total_found || (result.audios?.length || 0),
      query: query
    });

  } catch (error) {
    console.error('[Audio Search API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        audios: [],
        total_found: 0,
        query: ''
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  try {
    console.log('[Audio Search API] Health check requested');
    
    // Check backend service health
    const backendResponse = await fetch(`${BACKEND_URL}/api/audio/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (backendResponse.ok) {
      const backendHealth = await backendResponse.json();
      console.log('[Audio Search API] Backend service is healthy');
      
      return NextResponse.json({
        status: 'healthy',
        message: 'Audio search API is healthy',
        backend_status: backendHealth,
        timestamp: new Date().toISOString()
      });
    } else {
      console.warn('[Audio Search API] Backend service health check failed');
      
      return NextResponse.json({
        status: 'degraded',
        message: 'Backend service is not responding',
        timestamp: new Date().toISOString()
      }, { status: 503 });
    }
  } catch (error) {
    console.error('[Audio Search API] Health check error:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      message: 'Health check failed',
      error: String(error),
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
} 