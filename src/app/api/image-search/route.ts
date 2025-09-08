import { NextRequest, NextResponse } from 'next/server';

// Backend service URL
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// Logging functions
const logRequest = (data: any) => {
  console.log(`[Image Search API] Request received:
  - Query: "${data.query}"
  - Max images: ${data.max_images}
  - Orientation: ${data.orientation || 'all'}
  - Color: ${data.color || 'all'}
  - Order by: ${data.order_by || 'relevant'}`);
};

const logResponse = (success: boolean, imageCount?: number, error?: string) => {
  console.log(`[Image Search API] Response sent:
  - Success: ${success}
  - Image count: ${imageCount || 0}
  - Error: ${error || 'none'}`);
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, max_images = 60, orientation = "all", color = "all", order_by = "relevant" } = body;

    logRequest({ query, max_images, orientation, color, order_by });

    // Validate required parameters
    if (!query || typeof query !== 'string' || !query.trim()) {
      console.error('[Image Search API] Invalid request: query is required and must be a non-empty string');
      return NextResponse.json(
        { 
          success: false,
          message: 'Query is required and must be a non-empty string',
          images: [],
          total_found: 0,
          query: query || ''
        },
        { status: 400 }
      );
    }

    // Validate max_images parameter
    if (max_images !== undefined && (typeof max_images !== 'number' || max_images < 1 || max_images > 60)) {
      console.error('[Image Search API] Invalid request: max_images must be a number between 1 and 60');
      return NextResponse.json(
        { 
          success: false,
          message: 'max_images must be a number between 1 and 60',
          images: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    // Validate orientation parameter
    const validOrientations = ["all", "landscape", "portrait", "squarish"];
    if (orientation && !validOrientations.includes(orientation)) {
      console.error('[Image Search API] Invalid request: invalid orientation value');
      return NextResponse.json(
        { 
          success: false,
          message: `Orientation must be one of: ${validOrientations.join(', ')}`,
          images: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    // Validate color parameter
    const validColors = ["all", "black_and_white", "black", "white", "yellow", "orange", "red", "purple", "magenta", "green", "teal", "blue"];
    if (color && !validColors.includes(color)) {
      console.error('[Image Search API] Invalid request: invalid color value');
      return NextResponse.json(
        { 
          success: false,
          message: `Color must be one of: ${validColors.join(', ')}`,
          images: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    // Validate order_by parameter
    const validOrderBy = ["relevant", "latest", "popular"];
    if (order_by && !validOrderBy.includes(order_by)) {
      console.error('[Image Search API] Invalid request: invalid order_by value');
      return NextResponse.json(
        { 
          success: false,
          message: `order_by must be one of: ${validOrderBy.join(', ')}`,
          images: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    console.log(`[Image Search API] Processing request:`, {
      query: query.trim(),
      max_images,
      orientation,
      color,
      order_by
    });

    // Call backend service
    const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/api/image/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query.trim(),
        max_images,
        orientation,
        color,
        order_by
      }),
    });

    console.log(`[Image Search API] Backend response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Image Search API] Backend error: ${response.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${response.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Backend service error',
          images: [],
          total_found: 0,
          query: query
        },
        { status: 500 }
      );
    }

    const result = await response.json();
    
    // Validate backend response format
    if (!result || typeof result.success !== 'boolean') {
      console.error('[Image Search API] Invalid backend response format');
      logResponse(false, undefined, 'Invalid backend response format');
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Invalid response from backend service',
          images: [],
          total_found: 0,
          query: query
        },
        { status: 500 }
      );
    }

    logResponse(result.success, result.images?.length, result.message);

    // Return result, ensuring format consistency
    return NextResponse.json({
      success: result.success,
      message: result.message || (result.success ? 'Search completed' : 'Search failed'),
      images: result.images || [],
      total_found: result.total_found || (result.images?.length || 0),
      query: query
    });

  } catch (error) {
    console.error('[Image Search API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        images: [],
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
    console.log('[Image Search API] Health check requested');
    
    // Check backend service health
    const backendResponse = await fetch(`${BACKEND_URL}/api/image/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (backendResponse.ok) {
      const backendHealth = await backendResponse.json();
      console.log('[Image Search API] Backend service is healthy');
      
      return NextResponse.json({
        status: 'healthy',
        message: 'Image search API is healthy',
        backend_status: backendHealth,
        timestamp: new Date().toISOString()
      });
    } else {
      console.warn('[Image Search API] Backend service health check failed');
      
      return NextResponse.json({
        status: 'degraded',
        message: 'Backend service is not responding',
        timestamp: new Date().toISOString()
      }, { status: 503 });
    }
  } catch (error) {
    console.error('[Image Search API] Health check error:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      message: 'Health check failed',
      error: String(error),
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
} 