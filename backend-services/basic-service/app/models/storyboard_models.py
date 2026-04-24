"""
Data models for AI Storyboard generation, cropping, VL description,
batch video generation, and video composition.
"""

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.base_models import BaseResponse


# ---------------------------------------------------------------------------
# Limits — post-refactor, storyboard generation is fixed to 2x2 grids chained
# across batches of 4. User-facing scene count is capped at 16 (ceil(16/4)=4
# batches), matching UI validation.
# ---------------------------------------------------------------------------

STORYBOARD_MAX_SCENE_COUNT = 16
STORYBOARD_BATCH_SIZE = 4  # one 2x2 grid per batch


class PartialGenerationError(Exception):
    """Raised mid-way through a multi-batch storyboard run after at least one
    batch has succeeded. Carries the partially-complete pack so the router can
    surface a `partial=true` response without discarding the user's work.
    """

    def __init__(
        self,
        message: str,
        pack: Optional["StoryboardPack"] = None,
        completed_batches: int = 0,
        cause: Optional[BaseException] = None,
    ) -> None:
        super().__init__(message)
        self.pack = pack
        self.completed_batches = completed_batches
        self.cause = cause


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ScriptMessage(BaseModel):
    """A single chat message in the script-generation dialogue."""

    role: Literal["user", "assistant", "system"] = Field(..., description="Message role")
    content: str = Field(..., description="Message content")


class ScriptShot(BaseModel):
    """A single script shot — one paragraph bound to one storyboard frame."""

    index: int = Field(..., ge=0, description="Zero-based shot index")
    script: str = Field(..., description="Bound script paragraph")


class GenerateScriptRequest(BaseModel):
    """Request to generate a storyboard script (initial pass, no prior history)."""

    prompt: str = Field(..., max_length=2000, description="User prompt / theme")
    frame_count: int = Field(
        ...,
        ge=1,
        le=STORYBOARD_MAX_SCENE_COUNT,
        description=f"Number of scenes (1-{STORYBOARD_MAX_SCENE_COUNT})",
    )
    aspect_ratio: Literal["1:1", "16:9", "9:16", "4:3", "3:4"] = Field(default="1:1")
    locale: Literal["zh", "en"] = Field(default="zh", description="Output language")
    reference_images: Optional[List[str]] = Field(default=None, max_length=4)


class ReviseScriptRequest(BaseModel):
    """Request to revise an existing script given chat history and new user instruction."""

    frame_count: int = Field(..., ge=1, le=STORYBOARD_MAX_SCENE_COUNT)
    aspect_ratio: Literal["1:1", "16:9", "9:16", "4:3", "3:4"] = Field(default="1:1")
    locale: Literal["zh", "en"] = Field(default="zh")
    current_draft: List[ScriptShot] = Field(..., description="Current shot list before revision")
    history: List[ScriptMessage] = Field(default_factory=list, description="Prior chat turns")
    user_message: str = Field(..., min_length=1, description="New user instruction")


class StoryboardGenerateRequest(BaseModel):
    """Request to generate a multi-cell storyboard image via ARK Seedream.

    Post-refactor the storyboard pipeline always uses a 2x2 grid per ARK call
    and chains ``ceil(frame_count / 4)`` batches together. ``grid_size`` is
    therefore only allowed as the constant ``"2x2"`` (or omitted); any other
    value is rejected at validation time.
    """

    prompt: str = Field(
        ...,
        max_length=2000,
        description="User prompt describing the storyboard content",
    )
    grid_size: Optional[str] = Field(
        None,
        description="Deprecated. Only '2x2' or None is accepted; the backend always uses 2x2 internally.",
    )
    frame_count: Optional[int] = Field(
        None,
        ge=1,
        le=STORYBOARD_MAX_SCENE_COUNT,
        description=(
            f"Desired number of storyboard frames (1-{STORYBOARD_MAX_SCENE_COUNT}). "
            "Frames are generated in 2x2 batches; the backend runs ceil(N/4) sequential "
            "batches, chaining the last two frames of each batch into the next batch's "
            "reference image."
        ),
    )
    aspect_ratio: Literal["1:1", "16:9", "9:16", "4:3", "3:4"] = Field(
        default="1:1", description="Target aspect ratio for each storyboard cell"
    )
    reference_image: Optional[str] = Field(
        None, description="Optional reference image as base64 data URI"
    )
    reference_images: Optional[List[str]] = Field(
        default=None,
        max_length=4,
        description="Multi-reference images (max 4). Takes priority over reference_image.",
    )
    mentioned_images: Optional[Dict[str, str]] = Field(
        default=None,
        description="Mapping of @mention tags to image URLs/base64.",
    )
    # ── Script-bound generation (new two-step flow) ──
    frame_scripts: Optional[List[str]] = Field(
        default=None,
        description="Per-frame script paragraphs (length must equal resolved frame_count).",
    )
    script_history: Optional[List[ScriptMessage]] = Field(
        default=None,
        description="Chat history from the script drafting stage (for audit).",
    )
    locale: Literal["zh", "en"] = Field(
        default="zh", description="Output language hint propagated into ARK prompt"
    )
    pack_id: Optional[str] = Field(
        default=None, description="Optional stable pack_id for idempotent retries"
    )

    @field_validator("grid_size")
    @classmethod
    def validate_grid_size(cls, v: Optional[str]) -> Optional[str]:
        # The refactor restricts storyboard generation to 2x2 grids only.
        # Accept the literal string "2x2" or None (auto-defaulted by the
        # model validator below). Anything else is a hard 400 from the
        # router layer.
        if v is None or v == "2x2":
            return v
        raise ValueError(
            f"grid_size is deprecated; only '2x2' is supported, got {v!r} "
            "(GRID_SIZE_DEPRECATED)"
        )

    @model_validator(mode="after")
    def ensure_grid_or_frame_count(self) -> "StoryboardGenerateRequest":
        # Default to 4 frames (one 2x2 batch) when the client sends neither
        # grid_size nor frame_count. grid_size is always forced to "2x2" —
        # the old compute_optimal_grid branch has been removed.
        if self.frame_count is None:
            self.frame_count = STORYBOARD_BATCH_SIZE
        self.grid_size = "2x2"
        return self


class StoryboardDescribeRequest(BaseModel):
    """Request to generate VL_LLM descriptions for storyboard frames."""

    pack_id: str = Field(..., description="Storyboard pack ID")
    frame_indices: Optional[List[int]] = Field(
        None, description="Specific frame indices to describe (None = all frames)"
    )


class StoryboardVideoSegment(BaseModel):
    """Parameters for a single frame's video generation."""

    frame_index: int = Field(
        ..., description="Index of the frame in the storyboard pack"
    )
    description: str = Field(..., description="Scene description for video generation")
    duration: int = Field(
        default=5, ge=4, le=12, description="Video duration in seconds"
    )
    repeat: int = Field(
        default=1,
        ge=1,
        le=4,
        description="Number of candidate videos to generate (1-4)",
    )


class StoryboardBatchVideoRequest(BaseModel):
    """Request to batch-submit video generation tasks for storyboard frames."""

    pack_id: str = Field(..., description="Storyboard pack ID")
    segments: List[StoryboardVideoSegment] = Field(
        ..., description="List of frame segments to generate videos for"
    )


class StoryboardShotInput(BaseModel):
    """A single shot provided by the client when creating a script-bound pack."""

    shot_id: str = Field(..., min_length=1, description="Stable client-generated UUID")
    script: str = Field(..., min_length=1, description="Bound script paragraph")
    visual_prompt: Optional[str] = Field(None, description="Prompt used for generation")
    reference_image_url: Optional[str] = Field(None, description="Reference image URL")
    generated_image_url: str = Field(..., description="Generated frame image URL")


class StoryboardCreateFromShotsRequest(BaseModel):
    """Request to create a storyboard pack from AI-scripted shots."""

    title: Optional[str] = Field(None, description="Optional pack title")
    aspect_ratio: Literal["1:1", "16:9", "9:16", "4:3", "3:4"] = Field(
        default="1:1", description="Aspect ratio of shots"
    )
    shots: List[StoryboardShotInput] = Field(
        ..., min_length=1, max_length=32, description="List of shots in order"
    )
    script_history: Optional[List[Dict[str, str]]] = Field(
        None, description="Chat history (optional)"
    )


class StoryboardComposeRequest(BaseModel):
    """Request to compose (concatenate) storyboard videos into one video."""

    pack_id: str = Field(..., description="Storyboard pack ID")
    video_urls: List[str] = Field(
        ..., description="Ordered list of video URLs to concatenate"
    )


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class StoryboardFrame(BaseModel):
    """Metadata for a single cropped storyboard frame."""

    index: int = Field(..., description="Zero-based frame index")
    filename: str = Field(..., description="Frame image filename (e.g. frame_001.png)")
    url: str = Field(..., description="Accessible URL for the frame image")
    row: int = Field(..., description="Row position in the grid (0-based)")
    col: int = Field(..., description="Column position in the grid (0-based)")
    description: Optional[str] = Field(
        None, description="VL_LLM generated scene description"
    )
    # AI-scripted pack fields
    shot_id: Optional[str] = Field(None, description="Stable client-generated UUID for this shot")
    script: Optional[str] = Field(None, description="Bound script paragraph")
    visual_prompt: Optional[str] = Field(None, description="Prompt used for image generation")
    reference_image_url: Optional[str] = Field(None, description="Reference image URL")


class BatchInfo(BaseModel):
    """Per-batch accounting for a chained 2x2 storyboard run.

    Each batch corresponds to exactly one ARK Seedream call and yields up to
    four frames (fewer only when the whole run requests <4 scenes). The
    indexes here are GLOBAL — i.e. they index into ``StoryboardPack.frames``
    directly, so the frontend can group frames by batch without recomputing.
    """

    index: int = Field(..., description="Zero-based batch index")
    seedream_task_id: Optional[str] = Field(
        None, description="ARK request id (when returned by the provider)"
    )
    frame_indices: List[int] = Field(
        default_factory=list,
        description="Global frame indices produced by this batch",
    )
    duration_ms: Optional[int] = Field(
        None, description="End-to-end wall time for this batch"
    )
    started_at: Optional[str] = Field(None, description="ISO-8601 start timestamp")
    ended_at: Optional[str] = Field(None, description="ISO-8601 end timestamp")


class StoryboardPack(BaseModel):
    """Complete storyboard pack metadata."""

    pack_id: str = Field(..., description="Unique pack identifier")
    prompt: str = Field(..., description="Original user prompt")
    grid_size: str = Field(..., description="Grid specification (always '2x2' for newly generated packs)")
    aspect_ratio: str = Field(default="1:1", description="Aspect ratio of each frame")
    frame_count: int = Field(..., description="Total number of frames")
    created_at: str = Field(..., description="ISO-8601 creation timestamp")
    original_image_url: str = Field(
        ..., description="URL of the original storyboard image"
    )
    reference_image_url: Optional[str] = Field(
        None, description="URL of the user-provided reference image"
    )
    frames: List[StoryboardFrame] = Field(
        default_factory=list, description="List of cropped frame metadata"
    )
    # AI-scripted pack fields
    script_title: Optional[str] = Field(None, description="Script title")
    script_history: Optional[List[Dict[str, str]]] = Field(
        None, description="Chat history used to produce the script"
    )
    # ── Chained-batch accounting (new fields; Optional for backward compat) ──
    batches: Optional[List[BatchInfo]] = Field(
        None, description="Per-batch accounting; None for legacy single-shot packs"
    )
    partial: Optional[bool] = Field(
        None,
        description=(
            "True if generation failed before all batches completed; the "
            "pack only contains frames from the successful batches."
        ),
    )
    completed_batches: Optional[int] = Field(
        None, description="Number of batches that completed successfully"
    )
    total_batches: Optional[int] = Field(
        None, description="Total number of batches planned (ceil(frame_count/4))"
    )
    discarded_frame_count: Optional[int] = Field(
        None,
        description=(
            "Number of padding frames (e.g. when frame_count is not a multiple "
            "of 4) that were generated and deleted."
        ),
    )
    error: Optional[Dict[str, str]] = Field(
        None,
        description=(
            "Populated when partial=true. Shape: {code, message}. "
            "code=PARTIAL_GENERATION_FAILED for batch-level failures."
        ),
    )


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class StoryboardGenerateResponse(BaseResponse):
    """Response for storyboard generation."""

    data: Optional[StoryboardPack] = Field(
        None, description="Generated storyboard pack"
    )


class StoryboardDescribeResponse(BaseResponse):
    """Response for VL_LLM frame description generation."""

    descriptions: List[dict] = Field(
        default_factory=list,
        description="List of {index, description} dicts for each described frame",
    )


class StoryboardBatchVideoResponse(BaseResponse):
    """Response for batch video generation task submission."""

    tasks: List[dict] = Field(
        default_factory=list,
        description="List of {frame_index, ark_task_id} dicts",
    )


class StoryboardBatchVideoStatusResponse(BaseResponse):
    """Response for querying batch video generation status."""

    statuses: List[dict] = Field(
        default_factory=list,
        description="List of per-frame status dicts",
    )


class StoryboardListResponse(BaseResponse):
    """Response for listing storyboard packs."""

    data: List[StoryboardPack] = Field(
        default_factory=list, description="List of storyboard packs"
    )


class StoryboardComposeResponse(BaseResponse):
    """Response for video composition."""

    video_url: Optional[str] = Field(None, description="URL of the composed video")
    thumbnail_url: Optional[str] = Field(
        None, description="URL of the composed video thumbnail"
    )


class GenerateScriptResponse(BaseResponse):
    """Response carrying a generated (or revised) storyboard script."""

    shots: List[ScriptShot] = Field(default_factory=list, description="Ordered shots")
    raw_response: Optional[str] = Field(
        None, description="Raw LLM response for debugging (optional)"
    )
