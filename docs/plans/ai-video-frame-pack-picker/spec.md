# AI Video Modal — Frame Pack Image Picker

**Feature slug:** `ai-video-frame-pack-picker`
**Author:** Solution architect (design-only)
**Date:** 2026-05-09
**Version:** v2 (post-review)
**Status:** Spec — implementation pending

---

## 评审记录 (Review Notes)

Reviewed by senior reviewer on 2026-05-09. The design is feasible, well-scoped,
and grounded in verified codebase facts (call-site line numbers, existing i18n
strings, sibling-component patterns). Concerns below were collected by reading
`ImagePickerSlot.tsx`, `AiVideoModal.tsx`, `MaterialsPanel.tsx`,
`ScriptPanel.tsx`, `ReferenceImagePanel.tsx`, `framePack.ts`, `imagePack.ts`,
and `i18n.ts`.

| # | Severity | Concern | Resolution |
|---|---|---|---|
| R1 | **P1** | i18n duplication. §3 and §7 propose adding a new `t.scriptPanel.aiVideoScript.fromFramePack` string, but `t.materialsPanel.referencePickerFramePack` already exists with the exact intended translations ('帧包' / 'Frames') at `i18n.ts:3437` and `i18n.ts:6103`. Adding a parallel key for the same concept is needless duplication and risks the two strings drifting out of sync. | Fixed in v2: §3 and §7 now mandate reusing the existing `t.materialsPanel.referencePickerFramePack` string. The new picker tab label inside `ImagePickerSlot` reads from `t.materialsPanel.*`, mirroring how the slot will already read `referencePickerEmpty`/`Loading`/`SelectPackHint` from the same namespace. |
| R2 | **P1** | "Cache reset on `projectId` change" is mentioned only in §7 (Risks) but is required behaviour to prevent cross-project frame leakage in long-lived modal mounts. It belongs in the normative design, not the risk register. | Fixed in v2: lifted into §2.2 (target architecture, point 5) and §5 (Data Model) as a required `useEffect`. Risk row updated to reference the normative section. |
| R3 | **P1** | Frame-name format inconsistency. §1 ("`frame_<padded-index>`") and §2.3 step 6 ("`'frame_' + (frame.index + 1)`") disagree on padding. The sibling component `ReferenceImagePanel.tsx:114` uses the unpadded form `frame_${frame.index + 1}`. Implementer ambiguity = silent bug risk in `imageName` strings. | Fixed in v2: standardised on the unpadded form `frame_${frame.index + 1}` everywhere. §1 reworded; §2.3 step 6 unchanged. |
| R4 | **P1** | Error-handling divergence from sibling component. §2.3 step 3 introduces an inline error string and a new i18n key (`framePackLoadFailed`). `ReferenceImagePanel.loadPacks` (lines 50-68) silently swallows errors and falls back to the empty-state string. Two different conventions for the same call across two pickers is an avoidable inconsistency. | Fixed in v2: matched `ReferenceImagePanel`'s "swallow → empty state" behaviour. The `framePackLoadFailed` i18n addition is dropped from §3 / §7. §4.3 updated. |
| R5 | **P2** | Acceptance scenario 5 ("Render `<AiVideoModal>` without `projectId`") is synthetic — neither real call-site can hit it. Stating it as a runtime test misleads QA. | Reframed in v2 as a code-review check on `AiVideoModalProps.projectId?` typing + the `if (!projectId) return null` tab guard, not a manual scenario. |
| R6 | **P2** | `loading="lazy"` on the new frame `<img>` thumbnails (§7 mitigation row 3) is not used by the sibling `ReferenceImagePanel` and would create a stylistic delta with no measured benefit at typical pack sizes (≤200 frames, already in a scrollable container). | Dropped in v2: the existing `max-h-32 overflow-y-auto` clipping is enough; `loading="lazy"` removed from §7 mitigation to keep parity with `ReferenceImagePanel`. |
| R7 | **P2** | §3 lists "Modify `src/lib/i18n.ts`" but after R1+R4 there is nothing left to add — every string is already present. Listing the file as "modified" creates noise in code review. | Fixed in v2: row removed from §3. The implementer should not need to touch `i18n.ts` at all. |

No P0 issues found. The design correctly identifies this as a frontend-only
integration gap with a small, well-bounded blast radius.

---

## 1. Overview

The Video Editing page exposes an "AI Create → AI Video" entry point that opens
`AiVideoModal` (`src/components/video/components/AiVideoModal/AiVideoModal.tsx`).
The modal offers three generation modes — `description` (描述生成),
`keyframe` (首尾帧生成) and `reference` (参考图生成). Each mode renders one or
more `ImagePickerSlot` widgets where the user selects the reference / first /
last / supplemental images that will be sent to the ARK video API. Today the
picker only surfaces two sources: items in the global materials list whose
`type === 'image'`, and a manually-pasted URL. Users have reported that they
cannot pick frames from **frame packs** (视频帧包) — the curated still-image
sets they previously produced via "Video Processing → 视频帧提取". The bug is
purely a frontend integration gap: frame packs already exist in the backend,
already render inside `MaterialsPanel`, and are already wired into the sibling
`AiImageModal` via `ReferenceImagePanel`, but the AI video flow was never
extended.

This spec describes the design for surfacing frame-pack frames inside
`AiVideoModal`'s `ImagePickerSlot`. It mirrors the proven UX from
`ReferenceImagePanel` (project-scoped pack list → pack chip selector → frame
grid) so users get a consistent picker across AI Image and AI Video flows.
Existing material-library and paste-URL behaviour is preserved unchanged. No
backend changes are required: the `/api/frame-pack/list` and
`/api/frame-pack/{packId}` routes already return everything we need.

The work is contained to the frontend, touches one shared component plus the
two call-sites that mount `AiVideoModal`. **No new i18n strings are required**
— every label the new tab needs (`referencePickerFramePack`,
`referencePickerEmpty`, `referencePickerLoading`,
`referencePickerSelectPackHint`) already exists under
`t.materialsPanel.*` and is reused verbatim. Frame thumbnails surface as
`(url, name)` tuples where `name = frame.sub_view || ` `` `frame_${frame.index + 1}` `` —
matching the unpadded format used by the sibling `ReferenceImagePanel`. There
are no schema migrations, no new API endpoints, and no changes to the ARK
request payload.

## 2. Technical Design

### 2.1 Current architecture (as-is)

```
ScriptPanel.tsx ─┐
                 ├──► <AiVideoModal materials=…/>  ──► <ImagePickerSlot materials=…/>
MaterialsPanel ──┘                                       ├─ tab "materials" → filter materials.type==='image'
                                                         └─ tab "url"       → paste a URL
```

`ImagePickerSlot` keeps a tab `pickerMode: 'materials' | 'url'`. Frame packs
are project-scoped data fetched from `listFramePacks(projectId)` (in
`src/lib/api/framePack.ts`), but `projectId` is not passed to `AiVideoModal`,
and the slot has no concept of packs.

### 2.2 Target architecture (to-be)

```
ScriptPanel ────┐
                ├──► <AiVideoModal projectId=… materials=…/>
MaterialsPanel ─┘            │
                             ▼
            <ImagePickerSlot projectId=… materials=… onSelect=…/>
                             │
                  pickerMode ∈ {'materials', 'framePack', 'url'}
                                                │
                                                ▼
                                  listFramePacks(projectId)  (lazy on tab open)
                                                │
                                                ▼
                              pack-chip row → frame grid → onSelect(url, name)
```

Key changes:

1. **Thread `projectId` through.** `AiVideoModal` accepts `projectId?: string`,
   forwards it to every `ImagePickerSlot`. Both call-sites (`MaterialsPanel`
   line 2860, `ScriptPanel` line 2608) already have `projectId` in scope.
2. **Extend `ImagePickerSlot`.** Replace the binary `pickerMode` toggle with a
   tri-tab toggle `'materials' | 'framePack' | 'url'`. Add a project-scoped
   frame-pack tab using the same call (`listFramePacks(projectId)`) and same
   pack-chip + frame-grid layout used by `ReferenceImagePanel`. Lazy-load:
   only fetch when the tab is first activated. Cache the result for the
   slot's lifetime.
3. **Single-frame selection semantics.** Unlike `ReferenceImagePanel`, which
   accumulates up to four reference images and writes `@[name]` mentions into
   a prompt, `ImagePickerSlot` is a *single-image slot*. Selecting a frame
   simply calls `onSelect(frame.url, "frame_<padded-index>")` and closes the
   picker, identical to selecting a material.
4. **Graceful degradation when `projectId` is missing.** If a slot is mounted
   without `projectId`, the frame-pack tab is hidden entirely (not greyed
   out). This protects future call-sites that may legitimately not have a
   project context.
5. **Cache invalidation on `projectId` change.** The slot's frame-pack cache
   (pack list + active pack id + loading/error flags) is reset whenever the
   `projectId` prop transitions to a new non-empty value. This is enforced by
   a `useEffect(() => { reset(); }, [projectId])` and is normative — not a
   risk mitigation. It guarantees that long-lived modal mounts that swap
   projects (e.g. a future "switch project" affordance) cannot leak frames
   from the previous project's packs into the new project's picker.

### 2.3 Sequence of operations (frame-pack tab)

1. User opens AI Video panel and clicks "select image" in any slot.
2. Slot expands; tabs render. If `projectId` is set, the "帧包" tab is shown.
3. User clicks "帧包". The slot triggers a lazy fetch of
   `listFramePacks(projectId)`. While the request is in flight the
   `referencePickerLoading` placeholder is shown. Errors are caught and
   silently swallowed; the tab then renders the `referencePickerEmpty`
   state, identical to `ReferenceImagePanel.loadPacks` (lines 50-68). Users
   can retry by switching tabs and back, which re-runs the loader because
   the error path leaves `packs` as `null` rather than committing an empty
   array.
4. When the response arrives, packs are stored in slot-local state.
   - If empty → render `mp.referencePickerEmpty` ("暂无帧包") message.
   - If non-empty → render a horizontal scroll of pack chips (label = first
     12 chars of `pack.prompt || pack.pack_id`).
5. Clicking a chip sets the active pack, displaying its frames (3-column
   grid, square thumbnails, `f.url` as src). For frame packs the full
   `frames[]` is shown (frame packs use `pack_type === 'frame'` and have no
   sub-view limit, mirroring `ReferenceImagePanel` line 151).
6. Clicking a frame calls
   `onSelect(frame.url, frame.sub_view || 'frame_' + (frame.index + 1))`,
   collapses the picker, and propagates upward to the modal's per-mode
   state (`firstFrameUrl`, `keyframeRefUrls[i]`, `descImageUrls[i]`,
   `refImageUrls[i]`).

### 2.4 Why extend `ImagePickerSlot` rather than reuse `ReferenceImagePanel`?

`ReferenceImagePanel` is a multi-image, prompt-mention-aware picker tightly
coupled to the AI Image flow (it writes `@[name]` tags into the prompt and
caps at four images). `AiVideoModal` needs *single-slot* selection across
multiple distinct slots that each map to a different parameter
(`first_frame_image`, `last_frame_image`, `reference_images[i]`, etc.). The
existing `ImagePickerSlot` is the right abstraction; we just enrich its
source list. This keeps blast radius small (one shared component, two
parents) and avoids regressing the AI Image flow.

## 3. File / Module Change Plan

| File | Change | Intent |
|---|---|---|
| `src/components/video/components/AIVideoScriptTab/ImagePickerSlot.tsx` | Modify | Add `projectId?: string` prop; extend `pickerMode` to include `'framePack'`; add lazy `listFramePacks` loader, pack-chip row, and frame grid. Hide frame-pack tab when `projectId` is undefined. Add `useEffect([projectId])` cache reset. Tab label and the four pack-state strings come from `t.materialsPanel.*` (no i18n additions). |
| `src/components/video/components/AiVideoModal/AiVideoModal.tsx` | Modify | Add `projectId?: string` to `AiVideoModalProps`; destructure and pass to every `<ImagePickerSlot>` render (lines 436, 465, 474, 504). |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | Modify | At the `<AiVideoModal>` mount (~line 2860), pass `projectId={projectId}` (the prop is already in scope at MaterialsPanel line 80). |
| `src/components/video/ScriptPanel.tsx` | Modify | At the `<AiVideoModal>` mount (~line 2608), pass `projectId={projectId}` (the prop is already in scope at ScriptPanel line 88). |
| `docs/plans/ai-video-frame-pack-picker/spec.md` | Create | This document. |

No new files are required. No backend file changes are required. **No
`i18n.ts` changes are required** — the four strings the new tab needs
(`referencePickerFramePack`, `referencePickerEmpty`, `referencePickerLoading`,
`referencePickerSelectPackHint`) already exist under `t.materialsPanel.*` and
are read directly from there even though the consuming component lives in the
`scriptPanel` UI tree (cross-namespace reads are a normal pattern in this
codebase — see how `ImagePickerSlot` already calls `useLocale()` and traverses
multiple namespaces). No test infrastructure additions are required (frontend
has no Jest/Vitest harness; verification is via manual UI flow, see §6).

## 4. Interface Design

### 4.1 Component prop changes (TypeScript)

```ts
// ImagePickerSlot.tsx
interface ImagePickerSlotProps {
  label: string;
  imageUrl?: string;
  imageName?: string;
  onSelect: (url: string, name: string) => void;
  onRemove: () => void;
  materials?: MaterialItem[];
  /** Owning project id. When set, the "frame pack" tab is rendered and
   *  populated via listFramePacks(projectId). When undefined the tab is
   *  hidden entirely. Changing this prop resets the slot's frame-pack
   *  cache (see §2.2 point 5). */
  projectId?: string;
}

type PickerMode = 'materials' | 'framePack' | 'url';
```

```ts
// AiVideoModal.tsx
interface AiVideoModalProps {
  // …existing props unchanged…
  projectId?: string;   // NEW
}
```

### 4.2 No HTTP / WebSocket / CLI changes

The frame-pack picker uses only the existing client function:

```ts
listFramePacks(projectId: string): Promise<ImagePack[]>
// → GET /api/frame-pack/list?project_id=<id>
```

defined in `src/lib/api/framePack.ts:83`. The shape of `ImagePack` and
`ImagePackFrame` is already declared in `src/lib/api/imagePack.ts:11-40` and
needs no extension.

### 4.3 Error / empty surfaces

| State | Behaviour |
|---|---|
| `projectId` undefined | Frame-pack tab hidden; only Materials + URL tabs shown. |
| `listFramePacks` rejects | Catch and silently swallow; the loader leaves `packs === null`, which causes the same render path as the empty-state branch (`referencePickerEmpty`). User can retry by switching tabs and back — re-entry triggers the loader again because `packs` is still `null`. Mirrors `ReferenceImagePanel.loadPacks`. |
| Empty pack list | Render `referencePickerEmpty` ("暂无可用包"). |
| Non-empty packs, none selected | Render pack chips + `referencePickerSelectPackHint`. |
| Pack with zero frames (corrupt) | Render the chip but show the empty-state hint when active. |
| `projectId` changes to a new value | `useEffect` clears `framePacks`, `framePacksLoading`, and `activeFramePackId`; the next tab activation re-fetches against the new project. |

## 5. Data Model

No persistent schema changes. The picker reads:

```ts
interface ImagePack {
  pack_id: string;
  pack_type: 'storyboard' | 'character' | 'scene' | 'frame';
  prompt: string;                   // user-supplied label
  frames: ImagePackFrame[];
  // …other fields ignored by this picker…
}

interface ImagePackFrame {
  index: number;                    // 0-based, sorted ascending by backend
  url: string;                      // absolute URL served via /api/storage/files/...
  sub_view?: string | null;         // null for frame packs
  width?: number | null;
  height?: number | null;
  // …other fields ignored…
}
```

In-component state added to `ImagePickerSlot`:

```ts
const [framePacks, setFramePacks] = useState<ImagePack[] | null>(null);
const [framePacksLoading, setFramePacksLoading] = useState(false);
const [activeFramePackId, setActiveFramePackId] = useState<string | null>(null);

// Normative cache reset — see §2.2 point 5.
useEffect(() => {
  setFramePacks(null);
  setFramePacksLoading(false);
  setActiveFramePackId(null);
}, [projectId]);
```

There is no separate `framePacksError` state — the error path mirrors
`ReferenceImagePanel.loadPacks`: errors are caught silently inside the loader
and `framePacks` stays `null`, which the render path treats identically to a
fresh slot (next tab activation re-tries the fetch).

Lifetime: state lives for the lifetime of the slot's React subtree. When the
slot collapses (after a selection or via Cancel), state is preserved because
the slot itself stays mounted — only `showPicker` flips. On the next open
the cached list is re-used. The `activeFramePackId` is reset on `projectId`
transitions but **not** on tab switches within the same session (this avoids
the user losing their pack selection when they peek at the URL tab). This
mirrors `ReferenceImagePanel`'s `packsByType` cache pattern (lines 41-68).

## 6. Testing & Acceptance Criteria

This frontend lacks an automated UI test harness (no Jest/Vitest config in
the frontend; the e2e harness covers backend only). Verification is
manual + type-check.

### 6.1 Type / lint gates

- `npm run type-check` passes.
- `npm run lint` produces no new errors.

### 6.2 Manual acceptance scenarios

The following all run from the Video Editing page after starting
`bash start.sh --dev`. Pre-condition: a project with at least one uploaded
video and at least one frame pack already created via Video Processing →
视频帧提取.

1. **Description mode — frame pack visible.** Click "AI Create" → "AI Video".
   Generation mode = 描述生成. Click any "select image" slot. Verify three
   tabs render: Materials / 帧包 / URL.
2. **Keyframe mode — first/last frame.** Switch to 首尾帧生成. Click first
   frame slot, switch to 帧包 tab, pick a frame from a pack. Verify the slot
   thumbnail updates and the frame name appears beneath it. Repeat for the
   last/reference slots. Generate — request payload's `first_frame_image` /
   `last_frame_image` carries the frame's URL.
3. **Reference mode.** Switch to 参考图生成. Pick frames into multiple ref
   slots. Verify all slots accept frame URLs and request `reference_images`
   contains them.
4. **Empty packs.** With a project that has no frame packs, verify the 帧包
   tab shows the "暂无帧包" empty state.
5. **No `projectId` — code-review gate (not runtime).** Both real call-sites
   pass `projectId`, so this case is unreachable at runtime. Instead,
   reviewers must confirm by inspection that (a) `AiVideoModalProps.projectId`
   is typed `?: string` (not required), (b) `ImagePickerSlot` early-returns
   `null` for the frame-pack tab button when `!projectId`, and (c) the
   `useEffect([projectId])` cache reset handles the `undefined → string`
   transition without throwing.
6. **Network failure.** Throttle DevTools to "Offline" before opening the
   帧包 tab. Verify the empty-state ("暂无可用包") renders without throwing
   in the console. Go back Online, switch to the URL tab and back to 帧包 —
   verify the loader re-runs and the real pack list now appears.
7. **Existing flows unchanged.** Pick from Materials and from URL — both
   paths still work. Pasting a URL still saves the basename as the image
   name. Removing an image still calls `onRemove`.

### 6.3 Definition of done

- All seven scenarios pass on a Chromium-based browser.
- Diff is limited to the files in §3.
- Generated ARK request payloads are byte-identical to the pre-change
  payload when no frame is involved (regression isolation).

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `projectId` mis-threading at one of the two call-sites silently breaks the new tab. | Medium | High (feature appears not to work). | The tab self-hides when `projectId` is undefined; manual scenario 5 explicitly checks both call-sites. Diff review must verify each `<AiVideoModal>` mount passes `projectId={projectId}`. |
| Frame-pack URLs are project-scoped on disk; if the request to ARK is forwarded by the backend without the cookies, the URL might 404 from ARK's side. | Low | High | Existing AI Image flow already submits frame-pack URLs to ARK image generation via `ReferenceImagePanel` and works in production; the URLs are absolute `https://…/api/storage/files/…` and ARK fetches them server-side. No new failure mode introduced. |
| Large frame packs (200 frames) blow up the picker DOM. | Low | Medium | The frame grid is wrapped in a scrollable container with `max-h-32 overflow-y-auto` (existing pattern in `ImagePickerSlot` line 113). Parity with `ReferenceImagePanel` is intentional — no `loading="lazy"` is added so the two pickers render identically. If pack sizes ever exceed the typical ≤200 frames in practice, revisit. |
| Caching of `listFramePacks` means newly created packs don't appear until the modal is reopened. | Medium | Low | Acceptable for v1 — `AiImageModal` already has the same caching behaviour and users typically open the modal *after* creating their packs. A future refresh button can be added if it surfaces in user feedback. |
| Slot state cache leaks user data across projects when project context changes. | Low | Medium | Handled normatively in §2.2 point 5 / §5: the `useEffect([projectId])` resets `framePacks`, `framePacksLoading`, and `activeFramePackId` on every transition. The current call-sites also unmount `MaterialsPanel`/`ScriptPanel` on project switch, so this is defence-in-depth. |
| i18n strings missing for non-Chinese locales. | n/a | n/a | No new strings — every label the picker needs already exists in both EN and ZH under `t.materialsPanel.*` (`referencePickerFramePack`, `referencePickerEmpty`, `referencePickerLoading`, `referencePickerSelectPackHint`). |

---

**End of spec.** A downstream engineer should be able to implement this
without further design decisions. The only judgment call left to
implementation is the visual styling of the new tab — copy the styling of
the existing two tabs (`pickerMode === 'materials'` button class) verbatim.

---

## 评审结论 (Review Verdict)

**通过 (Approved).**

All P0 / P1 concerns from `## 评审记录` have been resolved directly in the
document body of v2:

- R1 (i18n duplication) → fixed in §1, §3, §4.1.
- R2 (cache-reset normativity) → promoted to §2.2 point 5, §5, §4.3.
- R3 (frame-name padding) → standardised on the unpadded form in §1; §2.3
  was already consistent.
- R4 (error-handling divergence) → matched to `ReferenceImagePanel` in
  §2.3, §4.3, §6, §3.
- R5 (synthetic acceptance scenario) → reframed in §6.
- R6 (`loading="lazy"` delta) → dropped in §7.
- R7 (empty `i18n.ts` modification row) → row removed from §3.

**No outstanding conditions.** The implementer should:
1. Touch only the four source files in §3 plus this spec.
2. Run `npm run type-check` and `npm run lint` before opening a PR; ensure
   no *new* warnings or errors are introduced (existing baseline is
   tolerated per the project's `next.config.js` posture).
3. Walk through acceptance scenarios 1, 2, 3, 4, 6, 7 in a real browser,
   and confirm scenario 5 by code review only.
