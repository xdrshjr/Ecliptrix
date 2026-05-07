import { http } from '@/lib/api/http-client'
import type { ImagePack } from '@/lib/api/imagePack'

interface DetailEnvelope {
  success?: boolean
  message?: string
  data?: ImagePack | null
}

interface ListEnvelope {
  success?: boolean
  message?: string
  data?: ImagePack[]
}

interface BaseEnvelope {
  success?: boolean
  message?: string
}

export interface CreateFramePackFrameInput {
  /** 1-based ordinal — must equal the file's ``frame_NNN`` ordinal. */
  index: number
  timestampSec: number
  width: number
  height: number
  blob: Blob
}

export interface CreateFramePackInput {
  projectId: string
  sourceMaterialId: string
  sourceMaterialName: string
  sourceDurationSec: number
  frames: CreateFramePackFrameInput[]
}

/**
 * Create a frame pack from a curated set of in-browser-captured JPEG frames.
 *
 * The caller is expected to have already pre-flighted the aggregate blob
 * size (see ``frame-pack-config.yaml > max_request_mb``) — the backend
 * also enforces it via Content-Length, but a client-side reject avoids
 * uploading 100s of MB just to be 413'd.
 */
export async function createFramePack(
  input: CreateFramePackInput,
): Promise<ImagePack> {
  const ordered = [...input.frames].sort((a, b) => a.index - b.index)

  const manifest = {
    frames: ordered.map((f) => ({
      index: f.index,
      timestamp_sec: f.timestampSec,
      width: f.width,
      height: f.height,
    })),
  }

  const formData = new FormData()
  formData.append('project_id', input.projectId)
  formData.append('source_material_id', input.sourceMaterialId)
  formData.append('source_material_name', input.sourceMaterialName)
  formData.append('source_duration_sec', String(input.sourceDurationSec))
  formData.append('manifest', JSON.stringify(manifest))
  for (const frame of ordered) {
    const padded = String(frame.index).padStart(3, '0')
    formData.append(`frame_${padded}`, frame.blob, `frame_${padded}.jpg`)
  }

  const data = await http.post<DetailEnvelope>(
    '/api/frame-pack/create',
    formData,
    { timeoutMs: 900_000 },
  )

  if (!data.success || !data.data) {
    throw new Error(data.message || 'Frame pack create failed')
  }
  return data.data
}

export async function listFramePacks(projectId: string): Promise<ImagePack[]> {
  const qs = `?project_id=${encodeURIComponent(projectId)}`
  const data = await http.get<ListEnvelope>(`/api/frame-pack/list${qs}`)
  if (!data.success) {
    throw new Error(data.message || 'Failed to list frame packs')
  }
  return data.data || []
}

export async function getFramePack(
  projectId: string,
  packId: string,
): Promise<ImagePack | null> {
  const qs = `?project_id=${encodeURIComponent(projectId)}`
  const data = await http.get<DetailEnvelope>(`/api/frame-pack/${packId}${qs}`)
  if (!data.success) {
    throw new Error(data.message || 'Failed to load frame pack')
  }
  return data.data || null
}

export async function deleteFramePack(
  projectId: string,
  packId: string,
): Promise<void> {
  const qs = `?project_id=${encodeURIComponent(projectId)}`
  const data = await http.del<BaseEnvelope>(`/api/frame-pack/${packId}${qs}`)
  if (!data.success) {
    throw new Error(data.message || 'Failed to delete frame pack')
  }
}
