'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowUpCircle, Check, Copy, RotateCcw, Upload, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/console/confirm-dialog'
import { toast } from '@/components/shell/toaster'
import { RelativeTime } from '@/components/shell/relative-time'
import { api, ApiError } from '@/lib/api/client'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import {
  DEFAULT_RELEASE_CHANNEL,
  RELEASE_PLATFORMS,
  MAX_RELEASE_BYTES,
  compareVersions,
  formatBytes,
  isAllowedArch,
  isAllowedExtension,
  isReleaseVersion,
  platformLabel,
  platformSpec,
} from '@/lib/releases'
import { uploadInstaller, type UploadProgress } from '@/lib/api/releaseUpload'
import type { AdminReleaseRowView, LatestReleaseView } from './release-types'

/**
 * Release console.
 *
 * Three things this panel refuses to do, each for a reason found while diagnosing
 * the original defect:
 *  - it never uploads a file the server would reject (extension, platform, arch
 *    and size are checked before the first byte leaves the browser, because a
 *    rejected 188 MB upload costs minutes and tells the operator nothing);
 *  - it never hides the difference between "published" and "current": rolling
 *    back means "point the channel at this older build", and a table where that
 *    is not visible invites publishing the wrong build;
 *  - it never deletes anything. Withdrawing keeps the file and the row, because
 *    the users who already installed that build are the people who need it back.
 */
export function ReleasesPanel({
  locale,
  releases,
  latest,
  canWrite,
}: {
  locale: Locale
  releases: AdminReleaseRowView[]
  latest: LatestReleaseView | null
  canWrite: boolean
}) {
  const tt = translator(locale)
  const router = useRouter()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [notesFor, setNotesFor] = useState<AdminReleaseRowView | null>(null)
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const isCurrent = (row: AdminReleaseRowView): boolean =>
    row.pointedBy.some((pointer) => pointer.channel === DEFAULT_RELEASE_CHANNEL)

  /**
   * Which pointer action a row may offer.
   *
   * Deliberately decided by VERSION, not by status. Choosing from status alone
   * left a published-but-not-current build with only "roll back to this build",
   * which the server refuses (a rollback must move the pointer backwards) — so
   * after "publish 1.0.3, roll back to 1.0.2" the operator had no way back to
   * 1.0.3 through the console, while the confirmation copy promised there was.
   */
  const nextStep = (row: AdminReleaseRowView): 'publish' | 'rollback' | null => {
    if (isCurrent(row)) return null
    if (row.status !== 'published') return 'publish'
    const current = currentVersionFor(row, releases, latest)
    const comparison = current === null ? null : compareVersions(row.version, current)
    return comparison !== null && comparison < 0 ? 'rollback' : 'publish'
  }

  const run = async (action: PendingAction) => {
    setBusy(true)
    try {
      await api.patch(`/api/v1/admin/releases/${action.row.id}`, { action: action.kind })
      toast.success(
        action.kind === 'publish'
          ? tt('admin.releases.published', { version: action.row.version })
          : action.kind === 'rollback'
            ? tt('admin.releases.rolledBack', { version: action.row.version })
            : tt('admin.releases.retracted', { version: action.row.version }),
      )
      setPending(null)
      router.refresh()
    } catch (thrown) {
      toast.error(thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  const copySha = async (row: AdminReleaseRowView) => {
    try {
      await navigator.clipboard.writeText(row.sha256)
      setCopiedId(row.id)
      window.setTimeout(() => setCopiedId(null), 1600)
    } catch {
      // A clipboard refusal is a browser permission problem, not a network one —
      // saying "check your connection" would send the operator chasing the wrong
      // thing. The checksum is selectable in the cell title, so hand-copy still works.
      toast.error(tt('admin.releases.copyFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">
          {latest
            ? tt('admin.releases.latestHint', { version: latest.version })
            : tt('admin.releases.noLatest')}
        </p>
        {canWrite ? (
          <Button icon={<Upload size={14} />} onClick={() => setUploadOpen(true)}>
            {tt('admin.releases.upload')}
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {[
                tt('admin.releases.version'),
                tt('admin.releases.platform'),
                tt('admin.releases.state'),
                tt('admin.releases.size'),
                tt('admin.releases.downloads'),
                tt('admin.releases.createdAt'),
                tt('common.actions'),
              ].map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  className={`px-3 py-2.5 text-xs font-medium text-[var(--muted)] ${
                    index === 6 ? 'text-right' : 'text-left'
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {releases.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)] last:border-0 align-top">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="mono text-xs">{row.version}</span>
                    {isCurrent(row) ? (
                      <Badge tone="accent">{tt('admin.releases.current')}</Badge>
                    ) : null}
                  </div>
                  <p className="mono mt-1 max-w-[22ch] truncate text-2xs text-[var(--muted)]" title={row.fileName}>
                    {row.fileName}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {platformLabel(row.platform)} · {row.arch}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={STATE_TONES[row.status] ?? 'neutral'}>
                    {tt(`admin.releases.state.${row.status}`)}
                  </Badge>
                  <p className="mt-1 text-2xs text-[var(--muted)]">
                    {row.publishedAt ? <RelativeTime iso={row.publishedAt} locale={locale} /> : '—'}
                  </p>
                </td>
                <td className="mono px-3 py-2.5 text-xs text-[var(--muted)]">
                  {formatBytes(row.byteSize)}
                </td>
                <td className="mono px-3 py-2.5 text-xs text-[var(--muted)]">{row.downloads}</td>
                <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                  <RelativeTime iso={row.createdAt} locale={locale} />
                  <p className="mt-1 max-w-[18ch] truncate text-2xs" title={row.createdByLabel ?? ''}>
                    {row.createdByLabel ?? '—'}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={copiedId === row.id ? <Check size={13} /> : <Copy size={13} />}
                      onClick={() => copySha(row)}
                    >
                      {tt('admin.releases.copySha')}
                    </Button>
                    {canWrite && nextStep(row) !== null ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={
                          nextStep(row) === 'rollback' ? <RotateCcw size={13} /> : <ArrowUpCircle size={13} />
                        }
                        onClick={() =>
                          setPending({ kind: nextStep(row) ?? 'publish', row })
                        }
                      >
                        {nextStep(row) === 'rollback'
                          ? tt('admin.releases.rollback')
                          : tt('admin.releases.publish')}
                      </Button>
                    ) : null}
                    {canWrite ? (
                      <Button variant="ghost" size="sm" onClick={() => setNotesFor(row)}>
                        {tt('admin.releases.notes')}
                      </Button>
                    ) : null}
                    {canWrite && row.status !== 'retracted' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPending({ kind: 'retract', row })}
                      >
                        {tt('admin.releases.retract')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {releases.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                  {tt('admin.releases.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <UploadDialog
        locale={locale}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false)
          router.refresh()
        }}
      />

      <NotesDialog
        key={notesFor?.id ?? 'closed'}
        locale={locale}
        release={notesFor}
        onClose={() => setNotesFor(null)}
        onSaved={() => {
          setNotesFor(null)
          router.refresh()
        }}
      />

      <ConfirmDialog
        locale={locale}
        open={pending !== null}
        title={pending ? confirmTitle(pending, tt) : ''}
        description={pending ? confirmDescription(pending, tt) : ''}
        confirmLabel={pending ? confirmLabel(pending, tt) : undefined}
        busy={busy}
        onConfirm={() => {
          if (pending) void run(pending)
        }}
        onClose={() => setPending(null)}
      />
    </div>
  )
}

const STATE_TONES: Record<string, 'accent' | 'warning' | 'neutral' | 'danger'> = {
  draft: 'warning',
  published: 'accent',
  retracted: 'neutral',
}

/**
 * Version currently served for this row's platform on the stable channel.
 *
 * Read from the rows themselves (`pointedBy`) rather than from `latest`, because
 * the two can legitimately disagree while a beta channel runs ahead — and the
 * comparison below is about THIS platform's pointer.
 */
function currentVersionFor(
  row: AdminReleaseRowView,
  releases: readonly AdminReleaseRowView[],
  latest: LatestReleaseView | null,
): string | null {
  const current = releases.find((candidate) =>
    candidate.pointedBy.some(
      (pointer) =>
        pointer.channel === DEFAULT_RELEASE_CHANNEL && pointer.platform === row.platform,
    ),
  )
  if (current) return current.version
  return latest?.platforms.find((platform) => platform.platform === row.platform)?.version ?? null
}

type PendingAction =
  | { kind: 'publish'; row: AdminReleaseRowView }
  | { kind: 'rollback'; row: AdminReleaseRowView }
  | { kind: 'retract'; row: AdminReleaseRowView }

type T = ReturnType<typeof translator>

function confirmTitle(action: PendingAction, tt: T): string {
  if (action.kind === 'publish') return tt('admin.releases.confirmPublishTitle', { version: action.row.version })
  if (action.kind === 'rollback') return tt('admin.releases.confirmRollbackTitle', { version: action.row.version })
  return tt('admin.releases.confirmRetractTitle', { version: action.row.version })
}

function confirmDescription(action: PendingAction, tt: T): string {
  if (action.kind === 'publish') return tt('admin.releases.confirmPublishDesc')
  if (action.kind === 'rollback') return tt('admin.releases.confirmRollbackDesc', { version: action.row.version })
  return tt('admin.releases.confirmRetractDesc')
}

function confirmLabel(action: PendingAction, tt: T): string {
  if (action.kind === 'publish') return tt('admin.releases.publish')
  if (action.kind === 'rollback') return tt('admin.releases.rollback')
  return tt('admin.releases.retract')
}

/**
 * Release notes for an already-published build.
 *
 * Notes are the one field an operator genuinely needs to correct after the fact
 * (a typo, a missing "what changed") and it is shown verbatim on `/download`, so it
 * is editable without re-publishing anything.
 */
function NotesDialog({
  locale,
  release,
  onClose,
  onSaved,
}: {
  locale: Locale
  release: AdminReleaseRowView | null
  onClose: () => void
  onSaved: () => void
}) {
  const tt = translator(locale)
  // The parent remounts this dialog per release (`key`), so the textarea always
  // starts from that row's notes: a stale note must never be saved onto the wrong
  // version.
  const [value, setValue] = useState(release?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!release) return
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/api/v1/admin/releases/${release.id}`, { action: 'notes', notes: value })
      toast.success(tt('admin.releases.notesSaved'))
      onSaved()
    } catch (thrown) {
      setError(thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={release !== null}
      onClose={onClose}
      title={tt('admin.releases.notes')}
      description={release ? `${release.version} · ${platformLabel(release.platform)} ${release.arch}` : ''}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tt('common.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {tt('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea value={value} maxLength={2000} onChange={(event) => setValue(event.target.value)} />
        {error ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

interface UploadForm {
  version: string
  platform: string
  arch: string
  notes: string
  file: File | null
}

function UploadDialog({
  locale,
  open,
  onClose,
  onUploaded,
}: {
  locale: Locale
  open: boolean
  onClose: () => void
  onUploaded: () => void
}) {
  const tt = translator(locale)
  const [form, setForm] = useState<UploadForm>({
    version: '',
    platform: RELEASE_PLATFORMS[0]?.id ?? 'win',
    arch: RELEASE_PLATFORMS[0]?.arches[0] ?? 'x64',
    notes: '',
    file: null,
  })
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const specs = RELEASE_PLATFORMS
  const arches = platformSpec(form.platform)?.arches ?? []

  const reset = () => {
    setForm({ version: '', platform: specs[0]?.id ?? 'win', arch: specs[0]?.arches[0] ?? 'x64', notes: '', file: null })
    setProgress(null)
    setErrors({})
  }

  /** Client-side mirror of the server rules: a rejection must be instant. */
  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {}
    // Same predicate the server uses, so the two cannot drift apart.
    if (!isReleaseVersion(form.version)) {
      found.version = tt('admin.settings.minVersion.invalid')
    }
    if (!form.file) {
      found.file = tt('common.required')
    } else {
      if (!isAllowedExtension(form.platform, form.file.name)) {
        found.file = tt('admin.releases.badExtension')
      }
      if (form.file.size > MAX_RELEASE_BYTES) {
        found.file = tt('errors.payload_too_large')
      }
    }
    if (!isAllowedArch(form.platform, form.arch)) {
      found.arch = tt('admin.releases.badArch')
    }
    return found
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0 || !form.file) return

    try {
      const created = await uploadInstaller(
        {
          version: form.version.trim(),
          platform: form.platform,
          arch: form.arch,
          fileName: form.file.name,
          file: form.file,
        },
        setProgress,
      )
      // Notes are a second, tiny request: they can be 2000 characters, and the
      // upload carries its metadata in the query string. Failing here does not undo
      // the upload — the draft exists and its notes are editable in the table.
      const notes = form.notes.trim()
      if (notes) {
        try {
          await api.patch(`/api/v1/admin/releases/${created.release.id}`, {
            action: 'notes',
            notes,
          })
        } catch {
          toast.error(tt('admin.releases.notesFailed'))
        }
      }
      toast.success(tt('admin.releases.uploaded'))
      reset()
      onUploaded()
    } catch (thrown) {
      setProgress(null)
      const message =
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network')
      setErrors({ form: message })
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={tt('admin.releases.upload')}
      description={tt('admin.releases.uploadHint')}
      size="md"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            {tt('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="release-upload-form"
            loading={progress !== null}
            icon={<UploadCloud size={14} />}
          >
            {progress ? tt('admin.releases.uploading', { percent: progress.percent }) : tt('common.save')}
          </Button>
        </>
      }
    >
      <form id="release-upload-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={tt('admin.releases.version')} htmlFor="release-version" required error={errors.version}>
          <Input
            id="release-version"
            className="mono"
            placeholder="1.0.2"
            value={form.version}
            onChange={(event) => setForm({ ...form, version: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={tt('admin.releases.platform')} htmlFor="release-platform">
            <Select
              id="release-platform"
              value={form.platform}
              onChange={(event) => {
                const platform = event.target.value
                setForm({
                  ...form,
                  platform,
                  arch: platformSpec(platform)?.arches[0] ?? form.arch,
                })
              }}
            >
              {specs.map((spec) => (
                <option key={spec.id} value={spec.id}>
                  {spec.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tt('admin.releases.arch')} htmlFor="release-arch" error={errors.arch}>
            <Select
              id="release-arch"
              value={form.arch}
              onChange={(event) => setForm({ ...form, arch: event.target.value })}
            >
              {arches.map((arch) => (
                <option key={arch} value={arch}>
                  {arch}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={tt('admin.releases.file')} htmlFor="release-file" required error={errors.file}>
          <input
            id="release-file"
            type="file"
            accept={(platformSpec(form.platform)?.extensions ?? []).join(',')}
            onChange={(event) => setForm({ ...form, file: event.target.files?.[0] ?? null })}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--surface)] file:px-2 file:py-1 file:text-xs"
          />
        </Field>

        <Field label={tt('admin.releases.notes')} htmlFor="release-notes">
          <Textarea
            id="release-notes"
            value={form.notes}
            maxLength={2000}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>

        {progress ? (
          <div aria-live="polite">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {tt('admin.releases.uploading', { percent: progress.percent })}
            </p>
          </div>
        ) : null}

        {errors.form ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
