# Ark Video Aspect Ratio & Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add aspect ratio (16:9 / 9:16 / 1:1) and resolution (480p / 720p / 1080p) selectors to the AI video generation panel (AiVideoModal).

**Architecture:** Parameters are embedded as flags at the end of the Ark API prompt string. We add `--ratio` and `--rs` flags following the official Volcengine Seedance API spec. Changes span 4 files: backend model, backend service, frontend API client, frontend modal UI.

**Tech Stack:** Python/Pydantic (backend model), FastAPI (backend service), TypeScript (frontend API client), React + Tailwind CSS (frontend modal UI)

---

### Task 1: Update backend request model

**Files:**
- Modify: `backend-services/basic-service/app/models/ark_video_models.py`

**Step 1: Read the current file**

Open `backend-services/basic-service/app/models/ark_video_models.py` and confirm current fields.

**Step 2: Add `aspect_ratio` and `resolution` fields to `ArkVideoGenerateRequest`**

Replace the existing `ArkVideoGenerateRequest` class with:

```python
class ArkVideoGenerateRequest(BaseModel):
    """Request model for creating an Ark video generation task."""
    prompt: str = Field(..., description="Text prompt describing the video to generate")
    duration: Literal[5, 10] = Field(default=5, description="Video duration in seconds (5 or 10)")
    camera_fixed: bool = Field(default=False, description="Whether to fix the camera position")
    watermark: bool = Field(default=False, description="Whether to add a watermark")
    image_url: Optional[str] = Field(default=None, description="Optional reference image URL")
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = Field(default="16:9", description="Video aspect ratio")
    resolution: Literal["480p", "720p", "1080p"] = Field(default="720p", description="Video resolution")
```

Note: The `Literal` import is already present. No new imports needed.

**Step 3: Verify syntax**

```bash
cd backend-services/basic-service && source venv/Scripts/activate && python -c "from app.models.ark_video_models import ArkVideoGenerateRequest; r = ArkVideoGenerateRequest(prompt='test'); print(r.aspect_ratio, r.resolution)"
```

Expected output: `16:9 720p`

**Step 4: Commit**

```bash
git add backend-services/basic-service/app/models/ark_video_models.py
git commit -m "[add] add aspect_ratio and resolution fields to ArkVideoGenerateRequest"
```

---

### Task 2: Update backend service to include new flags in prompt

**Files:**
- Modify: `backend-services/basic-service/app/services/ark_video_service.py:222-227`

**Step 1: Locate the param_flags block**

In `create_task()` (around line 222), find:
```python
param_flags = (
    f"--duration {request.duration} "
    f"--camerafixed {str(request.camera_fixed).lower()} "
    f"--watermark {str(request.watermark).lower()}"
)
```

**Step 2: Add `--ratio` and `--rs` flags**

Replace the `param_flags` block with:
```python
param_flags = (
    f"--duration {request.duration} "
    f"--camerafixed {str(request.camera_fixed).lower()} "
    f"--watermark {str(request.watermark).lower()} "
    f"--ratio {request.aspect_ratio} "
    f"--rs {request.resolution}"
)
```

**Step 3: Verify syntax**

```bash
cd backend-services/basic-service && source venv/Scripts/activate && python -c "from app.services.ark_video_service import create_task; print('OK')"
```

Expected output: `OK`

**Step 4: Commit**

```bash
git add backend-services/basic-service/app/services/ark_video_service.py
git commit -m "[add] pass --ratio and --rs flags to Ark API prompt"
```

---

### Task 3: Update frontend API client type

**Files:**
- Modify: `src/lib/api/arkVideo.ts`

**Step 1: Add new fields to `ArkVideoGenerateParams` interface**

Replace the existing `ArkVideoGenerateParams` interface:
```typescript
export interface ArkVideoGenerateParams {
  prompt: string;
  duration: 5 | 10;
  camera_fixed: boolean;
  watermark: boolean;
  image_url?: string;
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  resolution?: '480p' | '720p' | '1080p';
}
```

Both fields are optional (`?`) so existing callers that don't pass them still work — the backend defaults to `16:9` / `720p`.

**Step 2: Verify TypeScript**

```bash
npm run type-check 2>&1 | grep -E "(error|ark)" || echo "No errors"
```

Expected: `No errors` (or only pre-existing unrelated warnings)

**Step 3: Commit**

```bash
git add src/lib/api/arkVideo.ts
git commit -m "[add] add aspect_ratio and resolution to ArkVideoGenerateParams"
```

---

### Task 4: Update AiVideoModal UI

**Files:**
- Modify: `src/components/video/components/AiVideoModal/AiVideoModal.tsx`

**Step 1: Add new state variables**

At the top of the `AiVideoModal` component (after existing `useState` declarations at line ~22–28), add:
```typescript
const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p');
```

**Step 2: Reset new fields in `resetForm()`**

In the `resetForm` function, add:
```typescript
setAspectRatio('16:9');
setResolution('720p');
```

**Step 3: Include new fields in `onConfirm` call**

In `handleSubmit()`, update the `onConfirm` call:
```typescript
onConfirm({
  prompt: prompt.trim(),
  duration,
  camera_fixed: cameraFixed,
  watermark,
  image_url: imageUrl.trim() || undefined,
  aspect_ratio: aspectRatio,
  resolution,
});
```

**Step 4: Add aspect ratio selector UI**

Add the following JSX block **after** the Duration section (after the `</div>` that closes the duration `<div>`) and **before** the Reference Image URL section:

```tsx
{/* Aspect Ratio */}
<div>
  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
    视频比例
  </label>
  <div className="flex space-x-3">
    {([
      { value: '16:9', label: '16:9', desc: '横屏', icon: (
        <rect x="1" y="4" width="22" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      )},
      { value: '9:16', label: '9:16', desc: '竖屏', icon: (
        <rect x="7" y="1" width="10" height="22" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      )},
      { value: '1:1', label: '1:1', desc: '方形', icon: (
        <rect x="3" y="3" width="18" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      )},
    ] as const).map(({ value, label, desc, icon }) => (
      <button
        key={value}
        onClick={() => setAspectRatio(value)}
        className={`flex-1 py-2 px-2 rounded-xl text-sm font-medium border transition-all flex flex-col items-center space-y-1 ${
          aspectRatio === value
            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400'
        }`}
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
          {icon}
        </svg>
        <span>{label}</span>
        <span className={`text-xs ${aspectRatio === value ? 'text-white/80' : 'text-gray-400'}`}>{desc}</span>
      </button>
    ))}
  </div>
</div>
```

**Step 5: Add resolution selector UI**

Inside the `{showAdvanced && ...}` block, add a resolution selector **after** the watermark toggle:

```tsx
{/* Resolution */}
<div>
  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">分辨率</p>
  <div className="flex space-x-2">
    {(['480p', '720p', '1080p'] as const).map((r) => (
      <button
        key={r}
        onClick={() => setResolution(r)}
        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          resolution === r
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-indigo-400'
        }`}
      >
        {r}
      </button>
    ))}
  </div>
</div>
```

**Step 6: Verify TypeScript**

```bash
npm run type-check 2>&1 | grep -E "AiVideoModal|error TS" | head -20 || echo "No errors"
```

Expected: `No errors` (or only pre-existing unrelated issues)

**Step 7: Commit**

```bash
git add src/components/video/components/AiVideoModal/AiVideoModal.tsx
git commit -m "[add] add aspect ratio and resolution selectors to AiVideoModal"
```

---

### Task 5: Final verification

**Step 1: Run backend syntax check**

```bash
cd backend-services/basic-service && source venv/Scripts/activate && python -m pytest tests/test_syntax.py -v 2>&1 | tail -5
```

Expected: All passed.

**Step 2: Check frontend build**

```bash
npm run build 2>&1 | tail -10
```

Expected: Build succeeds (ESLint errors are ignored in build, per `next.config.js`).

**Step 3: Final commit summary**

All 4 files should be committed at this point. Verify:
```bash
git log --oneline -5
```

---

## Parameter Reference (Volcengine Seedance 1.5 Pro)

| Flag | Values | Default | Notes |
|------|--------|---------|-------|
| `--ratio` | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9` | API default | Aspect ratio |
| `--rs` | `480p`, `720p`, `1080p` | `720p` | Resolution |
| `--duration` | `5`, `10` | `5` | Duration in seconds |
| `--camerafixed` | `true`, `false` | `false` | Fix camera position |
| `--watermark` | `true`, `false` | `false` | Platform watermark |

Source: https://www.volcengine.com/docs/82379/1520757
