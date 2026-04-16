import { http } from '@/lib/api/http-client';

export type ImagePackType = 'storyboard' | 'character' | 'scene';

export interface ImagePackFrame {
  index: number;
  filename: string;
  url: string;
  row: number;
  col: number;
  sub_view?: string | null;
  description?: string | null;
}

export interface ImagePack {
  pack_id: string;
  pack_type: ImagePackType;
  prompt: string;
  grid_size: string;
  aspect_ratio: string;
  frame_count: number;
  sub_views: string[];
  created_at: string;
  original_image_url: string;
  reference_image_url?: string | null;
  frames: ImagePackFrame[];
}

interface ListEnvelope {
  success?: boolean;
  message?: string;
  data?: ImagePack[];
}

interface DetailEnvelope {
  success?: boolean;
  message?: string;
  data?: ImagePack | null;
}

interface BaseEnvelope {
  success?: boolean;
  message?: string;
}

export async function listImagePacks(type: ImagePackType): Promise<ImagePack[]> {
  const data = await http.get<ListEnvelope>(`/api/image-pack/${type}/list`);
  if (!data.success) {
    throw new Error(data.message || `Failed to list ${type} packs`);
  }
  return data.data || [];
}

export async function getImagePack(type: ImagePackType, packId: string): Promise<ImagePack | null> {
  const data = await http.get<DetailEnvelope>(`/api/image-pack/${type}/${packId}`);
  if (!data.success) {
    throw new Error(data.message || `Failed to load ${type} pack`);
  }
  return data.data || null;
}

export async function deleteImagePack(type: ImagePackType, packId: string): Promise<void> {
  const data = await http.del<BaseEnvelope>(`/api/image-pack/${type}/${packId}`);
  if (!data.success) {
    throw new Error(data.message || `Failed to delete ${type} pack`);
  }
}
