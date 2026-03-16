import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// POST fetch models for a saved provider
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  try {
    const { providerId } = await params;
    const response = await fetch(
      `${BACKEND_URL}/api/model-settings/providers/${providerId}/fetch-models`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching models for provider:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch models', models: [] },
      { status: 500 }
    );
  }
}
