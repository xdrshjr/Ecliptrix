import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/workflow/tavily-search
 * Performs a web search using Tavily API
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { keywords, count = 5, search_depth = 'basic', include_images = false, include_answer = false } = body;

    console.log('[API] Tavily search request:', {
      keywords,
      count,
      search_depth,
      timestamp: new Date().toISOString(),
    });

    if (!keywords || keywords.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'Keywords are required for Tavily search',
          query: keywords || '',
          results: [],
          total_results: 0,
        },
        { status: 400 }
      );
    }

    // Forward request to Python backend
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const apiUrl = `${backendUrl}/api/workflow/tavily-search`;

    console.log('[API] Forwarding request to backend:', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keywords: keywords.trim(),
        count: count,
        search_depth: search_depth,
        include_images: include_images,
        include_answer: include_answer,
      }),
    });

    const data = await response.json();

    console.log('[API] Backend response:', {
      success: data.success,
      resultsCount: data.total_results || 0,
      status: response.status,
    });

    if (!response.ok) {
      console.error('[API] Backend request failed:', {
        status: response.status,
        message: data.message || data.detail,
      });
      
      return NextResponse.json(
        {
          success: false,
          message: data.message || data.detail || 'Tavily search failed',
          query: keywords.trim(),
          results: [],
          total_results: 0,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data);

  } catch (error: any) {
    console.error('[API] Tavily search error:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Tavily search failed: ${error.message}`,
        query: '',
        results: [],
        total_results: 0,
      },
      { status: 500 }
    );
  }
}

