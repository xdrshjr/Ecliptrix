/**
 * Shapes the release console renders.
 *
 * Declared here rather than imported from `@/server/services/releaseService` so a
 * client component never even type-imports a module that pulls in `node:fs`. The
 * server builds these objects in `releaseService.adminList()`.
 */

export type ReleaseStatus = 'draft' | 'published' | 'retracted'

export interface AdminReleaseRowView {
  id: string
  version: string
  platform: string
  arch: string
  fileName: string
  byteSize: number
  sha256: string
  notes: string
  status: ReleaseStatus
  downloads: number
  createdAt: string
  publishedAt: string | null
  retractedAt: string | null
  createdByLabel: string | null
  /** Channels currently pointing at this release (`stable` = what users get). */
  pointedBy: { channel: string; platform: string }[]
}

export interface PublishedPlatformView {
  platform: string
  arch: string
  version: string
  fileName: string
  byteSize: number
  sha256: string
  notes: string
  publishedAt: string
  downloads: number
  downloadPath: string
}

export interface LatestReleaseView {
  version: string
  notes: string
  publishedAt: string | null
  channel: string
  platforms: PublishedPlatformView[]
}
