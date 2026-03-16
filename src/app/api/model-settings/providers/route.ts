import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// GET known provider types (static reference)
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/model-settings/providers/known`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching known providers:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch providers', providers: [] },
      { status: 500 }
    );
  }
}

// POST create a new provider credential
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await fetch(`${BACKEND_URL}/api/model-settings/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error creating provider:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create provider' },
      { status: 500 }
    );
  }
}
