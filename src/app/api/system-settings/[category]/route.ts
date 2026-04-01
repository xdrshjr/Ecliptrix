import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// GET all settings within a category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category } = await params;
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(`${BACKEND_URL}/api/system-settings/${category}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching category settings:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch category settings', category: '', settings: [] },
      { status: 500 }
    );
  }
}

// PUT batch-update settings within a category
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category } = await params;
    const body = await request.json();
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(`${BACKEND_URL}/api/system-settings/${category}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error updating category settings:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update category settings' },
      { status: 500 }
    );
  }
}
