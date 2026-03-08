import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ functionType: string }> }
) {
  try {
    const { functionType } = await params;
    const response = await fetch(`${BACKEND_URL}/api/model-settings/${functionType}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching model setting:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch model setting' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ functionType: string }> }
) {
  try {
    const { functionType } = await params;
    const response = await fetch(`${BACKEND_URL}/api/model-settings/${functionType}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error deleting model setting:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete model setting' },
      { status: 500 }
    );
  }
}
