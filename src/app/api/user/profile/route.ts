import { backendProxy } from '@/lib/api/server/backend-proxy'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const res = await backendProxy.get(req, '/api/user/profile')
  if (!res.ok) return res

  const data = await res.json()
  if (data.user) {
    data.user = {
      ...data.user,
      fullName: data.user.full_name,
      avatarUrl: data.user.avatar_url,
    }
  }
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function PUT(req: NextRequest) {
  // Resolve current user ID from session token
  const profileRes = await backendProxy.get(req, '/api/user/profile')
  if (!profileRes.ok) return profileRes
  const profileData = await profileRes.json()
  const userId = profileData.user?.id
  if (!userId) {
    return new Response(JSON.stringify({ success: false, message: 'User not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Transform body: camelCase → snake_case
  const body = await req.json()
  const backendBody = {
    username: body.username,
    email: body.email,
    full_name: body.fullName,
    avatar_url: body.avatarUrl,
  }

  // Create new request with transformed body
  const newReq = new NextRequest(req.url, {
    method: 'PUT',
    headers: req.headers,
    body: JSON.stringify(backendBody),
  })

  const res = await backendProxy.put(newReq, `/api/user/profile/${userId}`)
  if (!res.ok) return res

  const data = await res.json()
  if (data.user) {
    data.user = {
      ...data.user,
      fullName: data.user.full_name,
      avatarUrl: data.user.avatar_url,
    }
  }
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
