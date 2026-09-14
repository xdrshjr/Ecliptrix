"""
Timeline Parser Service for converting simplified AI editing responses to full timeline format.
Handles the conversion from simplified JSON structure to complete timeline JSON.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Any, List, Optional, Set, Tuple
from app.logger import get_logger
from app.models.ai_mixed_editing_models import (
    MAX_SEGMENT_VOLUME_PERCENT,
    SimplifiedTimelineModel,
    VideoSegmentModel, 
    AudioSegmentModel,
    ImageSegmentModel,
    MaterialItemModel
)

logger = get_logger(__name__)

# Segments shorter than this are unusable on the timeline and in export.
MIN_SEGMENT_SECONDS = 0.1
# Float slack when deciding whether two same-lane segments overlap.
OVERLAP_EPSILON = 1e-3
# Clipping by more than this is logged as a warning, anything less as debug.
CLIP_LOG_TOLERANCE_SECONDS = 0.1
SEGMENT_LISTS = ("video_segments", "audio_segments", "image_segments")
LIST_MATERIAL_TYPES = {
    "video_segments": "video",
    "audio_segments": "audio",
    "image_segments": "image",
}
# Audio lanes an AI plan may use; further lanes share the last one.
MAX_AUDIO_LANES = 4
# Track names the model sometimes reuses for audio; they would collide with
# the parsed timeline's own video / image track ids.
_NON_AUDIO_TRACK_PREFIXES = ("video-track", "image-track")
_TRAILING_NUMBER = re.compile(r"(\d+)\s*$")


@dataclass
class SanitizeReport:
    """Readable record of what sanitising changed in an AI mix plan."""

    dropped: List[str] = field(default_factory=list)
    adjusted: List[str] = field(default_factory=list)
    # id(segment) -> the model's own "list[index]", so steps that work on
    # filtered or re-routed lists still name the segment the model wrote.
    labels: Dict[int, str] = field(default_factory=dict, repr=False)

    def warnings(self) -> List[str]:
        """Dropped then adjusted lines, as written to metadata.warnings."""
        return [*self.dropped, *self.adjusted]

    def remember_label(self, segment: Any, label: str) -> None:
        """Record the model's original ``list[index]`` for a segment."""
        self.labels[id(segment)] = label

    def label_of(self, segment: Any, fallback: str) -> str:
        """The segment's original name, or ``fallback`` if unrecorded."""
        return self.labels.get(id(segment), fallback)


class TimelineParserService:
    """Service for parsing simplified timeline data to full timeline format."""
    
    def __init__(self):
        """Initialize the timeline parser service."""
        self.logger = logger
    
    def _generate_item_id(self, material_type: str, material_id: str, index: int) -> str:
        """
        Generate unique item ID for timeline items.
        
        Args:
            material_type: Type of material (video, audio, image)
            material_id: Original material ID
            index: Index for uniqueness
            
        Returns:
            str: Generated unique item ID
        """
        return f"item-{material_type}-{material_id}-{index:03d}"
    
    def _get_material_color(self, material_type: str) -> str:
        """
        Get color for timeline items based on material type.
        
        Args:
            material_type: Type of material
            
        Returns:
            str: Color hex code
        """
        color_map = {
            'video': '#3b82f6',    # Blue for video
            'audio': '#10b981',    # Green for audio  
            'image': '#f59e0b'     # Yellow for image
        }
        return color_map.get(material_type, '#6b7280')  # Gray as default
    
    def _find_material_by_id(self, material_id: str, materials: List[MaterialItemModel]) -> Optional[MaterialItemModel]:
        """
        Find material by ID from materials list.
        
        Args:
            material_id: Material ID to search for
            materials: List of available materials
            
        Returns:
            MaterialItemModel or None: Found material or None
        """
        for material in materials:
            if material.id == material_id:
                return material
        return None
    
    def _create_video_track_items(
        self, 
        video_segments: List[VideoSegmentModel], 
        materials: List[MaterialItemModel]
    ) -> List[Dict[str, Any]]:
        """
        Create video track items from video segments.
        
        Args:
            video_segments: List of video segments
            materials: List of available materials
            
        Returns:
            List[Dict[str, Any]]: Video track items
        """
        items = []
        
        for index, segment in enumerate(video_segments):
            material = self._find_material_by_id(segment.material_id, materials)
            if not material:
                self.logger.warning(f"Material not found for video segment: {segment.material_id}")
                continue
                
            # Calculate clip end if not provided
            clip_end = segment.clip_end
            if clip_end is None:
                clip_end = segment.clip_start + segment.duration
                
            item = {
                "id": self._generate_item_id("video", segment.material_id, index),
                "name": material.name,
                "type": "video",
                "startTime": segment.start_time,
                "duration": segment.duration,
                "trackId": "video-track-1",
                "color": self._get_material_color("video"),
                "materialId": segment.material_id,
                "volume": 1,
                "opacity": 1,
                "clipStart": segment.clip_start,
                "clipEnd": clip_end,
                "originalDuration": material.duration or segment.duration,
                "originalMaterialType": "video"
            }
            
            # Add thumbnail if available
            if material.thumbnailUrl:
                item["thumbnailUrl"] = material.thumbnailUrl
                
            items.append(item)
            
        return items
    
    def _create_image_track_items(
        self, 
        image_segments: List[ImageSegmentModel], 
        materials: List[MaterialItemModel]
    ) -> List[Dict[str, Any]]:
        """
        Create image track items from image segments.
        
        Args:
            image_segments: List of image segments
            materials: List of available materials
            
        Returns:
            List[Dict[str, Any]]: Image track items
        """
        items = []
        
        for index, segment in enumerate(image_segments):
            material = self._find_material_by_id(segment.material_id, materials)
            if not material:
                self.logger.warning(f"Material not found for image segment: {segment.material_id}")
                continue
                
            item = {
                "id": self._generate_item_id("image", segment.material_id, index),
                "name": material.name,
                "type": "video",  # Images use video type in timeline
                "startTime": segment.start_time,
                "duration": segment.duration,
                "trackId": "image-track-1",
                "color": self._get_material_color("image"),
                "materialId": segment.material_id,
                "volume": 1,
                "opacity": 1,
                "clipStart": 0,
                "clipEnd": segment.duration,
                "originalDuration": segment.duration,
                "originalMaterialType": "image"
            }
            
            # Add thumbnail if available
            if material.thumbnailUrl:
                item["thumbnailUrl"] = material.thumbnailUrl
                
            items.append(item)
            
        return items
    
    def _create_audio_track_items(
        self, 
        audio_segments: List[AudioSegmentModel], 
        materials: List[MaterialItemModel]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Create audio track items from audio segments, grouped by track.
        
        Args:
            audio_segments: List of audio segments
            materials: List of available materials
            
        Returns:
            Dict[str, List[Dict[str, Any]]]: Audio track items grouped by track ID
        """
        tracks_items = {}
        
        for index, segment in enumerate(audio_segments):
            material = self._find_material_by_id(segment.material_id, materials)
            if not material:
                self.logger.warning(f"Material not found for audio segment: {segment.material_id}")
                continue
                
            # Calculate clip end if not provided
            clip_end = segment.clip_end
            if clip_end is None:
                clip_end = segment.clip_start + segment.duration
                
            item = {
                "id": self._generate_item_id("audio", segment.material_id, index),
                "name": material.name,
                "type": "audio",
                "startTime": segment.start_time,
                "duration": segment.duration,
                "trackId": segment.track,
                "color": self._get_material_color("audio"),
                "materialId": segment.material_id,
                # Percentage (100 = original loudness) -> gain (1.0)
                "volume": round(
                    max(0.0, min(segment.volume, MAX_SEGMENT_VOLUME_PERCENT))
                    / 100.0,
                    3,
                ),
                "opacity": 1,
                "clipStart": segment.clip_start,
                "clipEnd": clip_end,
                "originalDuration": material.duration or segment.duration,
                "originalMaterialType": "audio"
            }
            
            # Initialize track if not exists
            if segment.track not in tracks_items:
                tracks_items[segment.track] = []
                
            tracks_items[segment.track].append(item)
            
        return tracks_items
    
    def _create_timeline_metadata(
        self, 
        task_id: str, 
        simplified_timeline: SimplifiedTimelineModel,
        materials: List[MaterialItemModel]
    ) -> Dict[str, Any]:
        """
        Create timeline metadata section.
        
        Args:
            task_id: Task identifier
            simplified_timeline: Simplified timeline data
            materials: List of materials
            
        Returns:
            Dict[str, Any]: Timeline metadata
        """
        # Count total items
        total_items = (
            len(simplified_timeline.video_segments) + 
            len(simplified_timeline.audio_segments) + 
            len(simplified_timeline.image_segments)
        )
        
        # Count tracks (base tracks + additional audio tracks if needed)
        track_count = 3  # video-track-1, image-track-1, audio-track-1
        audio_tracks = set(segment.track for segment in simplified_timeline.audio_segments)
        if len(audio_tracks) > 1:
            track_count += len(audio_tracks) - 1
            
        return {
            "exported_at": datetime.now().isoformat() + "Z",
            "version": "1.0.0",
            "task_id": task_id,
            "total_duration": simplified_timeline.total_duration,
            "track_count": track_count,
            "item_count": total_items
        }
    
    def _create_timeline_state(self, total_duration: float) -> Dict[str, Any]:
        """
        Create timeline state section.
        
        Args:
            total_duration: Total timeline duration
            
        Returns:
            Dict[str, Any]: Timeline state
        """
        return {
            "currentTime": 0,
            "totalDuration": total_duration,
            "zoomLevel": 1,
            "selectedItems": [],
            "playbackRate": 1,
            "isPlaying": False,
            "snapToGrid": True,
            "gridSize": 0.5,
            "scrollLeft": 0
        }
    
    def _create_tracks(
        self, 
        simplified_timeline: SimplifiedTimelineModel,
        materials: List[MaterialItemModel]
    ) -> List[Dict[str, Any]]:
        """
        Create tracks section with all items.
        
        Args:
            simplified_timeline: Simplified timeline data
            materials: List of materials
            
        Returns:
            List[Dict[str, Any]]: Timeline tracks
        """
        tracks = []
        
        # Create video track
        video_items = self._create_video_track_items(simplified_timeline.video_segments, materials)
        tracks.append({
            "id": "video-track-1",
            "name": "Video Track",
            "type": "video",
            "height": 80,
            "isLocked": False,
            "isMuted": False,
            "isVisible": True,
            "volume": 100,
            "order": 0,
            "items": video_items
        })
        
        # Create image track
        image_items = self._create_image_track_items(simplified_timeline.image_segments, materials)
        tracks.append({
            "id": "image-track-1",
            "name": "Image Track",
            "type": "video",  # Images use video type
            "height": 80,
            "isLocked": False,
            "isMuted": False,
            "isVisible": True,
            "volume": 100,
            "order": 1,
            "items": image_items
        })
        
        # Create audio tracks
        audio_tracks_items = self._create_audio_track_items(simplified_timeline.audio_segments, materials)
        
        # Create audio-track-1 (always present)
        tracks.append({
            "id": "audio-track-1",
            "name": "Audio Track 1",
            "type": "audio",
            "height": 60,
            "isLocked": False,
            "isMuted": False,
            "isVisible": True,
            "volume": 100,
            "order": 2,
            "items": audio_tracks_items.get("audio-track-1", [])
        })
        
        # Create additional audio tracks if needed
        order = 3
        for track_id, items in audio_tracks_items.items():
            if track_id != "audio-track-1":
                track_number = track_id.split("-")[-1]
                tracks.append({
                    "id": track_id,
                    "name": f"Audio Track {track_number}",
                    "type": "audio",
                    "height": 60,
                    "isLocked": False,
                    "isMuted": False,
                    "isVisible": True,
                    "volume": 100,
                    "order": order,
                    "items": items
                })
                order += 1
        
        return tracks
    
    def _create_materials_section(self, materials: List[MaterialItemModel]) -> List[Dict[str, Any]]:
        """
        Create materials section for timeline.
        
        Args:
            materials: List of materials
            
        Returns:
            List[Dict[str, Any]]: Materials for timeline
        """
        materials_data = []
        
        for material in materials:
            material_data = {
                "id": material.id,
                "name": material.name,
                "type": material.type,
                "format": material.format,
                "size": material.size,
                "url": material.url,
                "createdAt": material.createdAt
            }
            
            # Add optional fields if present
            if material.duration is not None:
                material_data["duration"] = material.duration
            if material.width is not None:
                material_data["width"] = material.width
            if material.height is not None:
                material_data["height"] = material.height
            if material.thumbnailUrl:
                material_data["thumbnailUrl"] = material.thumbnailUrl
            if material.serverUrl:
                material_data["serverUrl"] = material.serverUrl
            if material.description:
                material_data["description"] = material.description
            if material.tags:
                material_data["tags"] = material.tags
            if material.metadata:
                material_data["metadata"] = material.metadata
                
            materials_data.append(material_data)
            
        return materials_data
    
    def parse_simplified_timeline(
        self, 
        simplified_timeline: SimplifiedTimelineModel,
        materials: List[MaterialItemModel],
        task_id: str,
        warnings: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Parse simplified timeline to full timeline format.
        
        Args:
            simplified_timeline: Simplified timeline data
            materials: List of available materials
            task_id: Task identifier
            warnings: Sanitise warnings stored as ``metadata.warnings``
            
        Returns:
            Dict[str, Any]: Full timeline JSON data
            
        Raises:
            Exception: If parsing fails
        """
        try:
            self.logger.info(
                f"Starting timeline parsing for task: {task_id}",
                extra={
                    "task_id": task_id,
                    "total_duration": simplified_timeline.total_duration,
                    "video_segments": len(simplified_timeline.video_segments),
                    "audio_segments": len(simplified_timeline.audio_segments),
                    "image_segments": len(simplified_timeline.image_segments),
                    "materials_count": len(materials)
                }
            )
            
            # Create full timeline structure
            timeline_data = {
                "metadata": self._create_timeline_metadata(task_id, simplified_timeline, materials),
                "timeline": self._create_timeline_state(simplified_timeline.total_duration),
                "tracks": self._create_tracks(simplified_timeline, materials),
                "materials": self._create_materials_section(materials)
            }
            timeline_data["metadata"]["warnings"] = list(warnings or [])
            
            self.logger.info(
                f"Timeline parsing completed successfully for task: {task_id}",
                extra={
                    "task_id": task_id,
                    "generated_tracks": len(timeline_data["tracks"]),
                    "generated_items": sum(len(track["items"]) for track in timeline_data["tracks"]),
                    "total_duration": timeline_data["metadata"]["total_duration"]
                }
            )
            
            return timeline_data
            
        except Exception as e:
            error_msg = f"Timeline parsing failed for task {task_id}: {str(e)}"
            self.logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            raise Exception(error_msg)
    
    def validate_simplified_timeline(self, simplified_timeline: SimplifiedTimelineModel) -> bool:
        """
        Validate simplified timeline data for consistency.
        Automatically clips segments that exceed total duration and removes
        segments shorter than MIN_SEGMENT_SECONDS (a 0s item can be neither
        imported nor exported).

        Args:
            simplified_timeline: Simplified timeline data to validate

        Returns:
            bool: True if valid, False otherwise
        """
        try:
            total_duration = simplified_timeline.total_duration
            if total_duration <= 0:
                self.logger.error("Invalid total duration: must be positive")
                return False

            for list_name in SEGMENT_LISTS:
                clipped = self._clip_segments_for_validation(
                    getattr(simplified_timeline, list_name),
                    total_duration,
                    list_name,
                )
                setattr(simplified_timeline, list_name, clipped)

            self.logger.info("Simplified timeline validation passed")
            return True

        except Exception as e:
            self.logger.error(f"Timeline validation error: {str(e)}", exc_info=True)
            return False

    def _clip_segments_for_validation(
        self, segments: List[Any], total_duration: float, list_name: str
    ) -> List[Any]:
        """Clip segments ending past ``total_duration``; drop too-short ones."""
        kept = []
        for segment in segments:
            excess = segment.start_time + segment.duration - total_duration
            if excess > 0:
                new_duration = total_duration - segment.start_time
                log = (
                    self.logger.warning
                    if excess > CLIP_LOG_TOLERANCE_SECONDS
                    else self.logger.debug
                )
                log(
                    f"{list_name} segment exceeds total duration by "
                    f"{excess:.3f}s, clipping: {segment.material_id} "
                    f"(duration: {segment.duration:.3f}s -> "
                    f"{new_duration:.3f}s)"
                )
                segment.duration = max(0.0, new_duration)
            if segment.duration < MIN_SEGMENT_SECONDS:
                self.logger.warning(
                    f"{list_name} segment shorter than {MIN_SEGMENT_SECONDS}s "
                    f"removed: {segment.material_id}"
                )
                continue
            kept.append(segment)
        return kept

    # ── AI mix plan sanitising (AM-06) ──

    def sanitize_simplified_timeline(
        self,
        timeline: SimplifiedTimelineModel,
        materials: List[MaterialItemModel],
    ) -> SanitizeReport:
        """
        Make an LLM editing plan importable, mutating ``timeline`` in place.

        Steps: map audio track names onto ``audio-track-n``; move images
        referenced from video_segments into image_segments and drop unknown /
        mistyped material references; clamp video and audio source ranges to
        the material duration keeping ``duration == clip_end - clip_start``;
        clip to total_duration and drop segments shorter than
        MIN_SEGMENT_SECONDS; pack every lane (video, image, one per audio
        track) flush from 0 so the editor's auto-organize changes nothing;
        report audio / image running past the video lane. total_duration
        finally becomes the latest segment end.

        Args:
            timeline: LLM plan to sanitise (modified in place)
            materials: Materials the plan may reference

        Returns:
            SanitizeReport: one readable line per dropped / adjusted segment

        Raises:
            ValueError: no usable segment is left
        """
        report = SanitizeReport()
        by_id = {material.id: material for material in materials}
        self._canonicalise_audio_tracks(timeline, report)
        self._reroute_by_material_type(timeline, by_id, report)
        self._normalise_source_range(timeline, by_id, report)
        self._clip_to_total(timeline, report)
        self._pack_lanes(timeline, report)
        self._warn_past_video_end(timeline, report)

        segments = _all_segments(timeline)
        if not segments:
            raise ValueError("no usable segments after sanitising")
        timeline.total_duration = max(
            segment.start_time + segment.duration for segment in segments
        )
        if report.dropped or report.adjusted:
            self.logger.warning(
                f"AI mix plan sanitised: {len(report.dropped)} dropped, "
                f"{len(report.adjusted)} adjusted",
                extra={"sanitize_warnings": report.warnings()[:20]},
            )
        return report

    def _reroute_by_material_type(
        self,
        timeline: SimplifiedTimelineModel,
        by_id: Dict[str, MaterialItemModel],
        report: SanitizeReport,
    ) -> None:
        """Move images out of video_segments; drop unknown or mistyped refs."""
        for list_name in SEGMENT_LISTS:
            for index, segment in enumerate(getattr(timeline, list_name)):
                report.remember_label(segment, f"{list_name}[{index}]")
        video_candidates: List[Tuple[int, VideoSegmentModel]] = []
        moved_images: List[ImageSegmentModel] = []
        for index, segment in enumerate(timeline.video_segments):
            material = by_id.get(segment.material_id)
            if material is None or material.type != "image":
                video_candidates.append((index, segment))
                continue
            image = ImageSegmentModel(
                material_id=segment.material_id,
                start_time=segment.start_time,
                duration=segment.duration,
            )
            report.remember_label(image, f"video_segments[{index}]")
            moved_images.append(image)
            report.adjusted.append(
                f"video_segments[{index}]: material {segment.material_id} "
                "is an image, moved to image_segments"
            )

        timeline.video_segments = self._keep_matching_type(
            "video_segments", video_candidates, by_id, report
        )
        timeline.audio_segments = self._keep_matching_type(
            "audio_segments",
            list(enumerate(timeline.audio_segments)),
            by_id,
            report,
        )
        kept_images = self._keep_matching_type(
            "image_segments",
            list(enumerate(timeline.image_segments)),
            by_id,
            report,
        )
        timeline.image_segments = kept_images + moved_images

    def _keep_matching_type(
        self,
        list_name: str,
        indexed_segments: List[Tuple[int, Any]],
        by_id: Dict[str, MaterialItemModel],
        report: SanitizeReport,
    ) -> List[Any]:
        """Segments whose material exists and matches the list's type."""
        expected_type = LIST_MATERIAL_TYPES[list_name]
        kept = []
        for index, segment in indexed_segments:
            material = by_id.get(segment.material_id)
            if material is not None and material.type == expected_type:
                kept.append(segment)
                continue
            problem = (
                "not found"
                if material is None
                else f"is {material.type}, not {expected_type}"
            )
            report.dropped.append(
                f"{list_name}[{index}]: material {segment.material_id} "
                f"{problem}, dropped"
            )
        return kept

    def _normalise_source_range(
        self,
        timeline: SimplifiedTimelineModel,
        by_id: Dict[str, MaterialItemModel],
        report: SanitizeReport,
    ) -> None:
        """Clamp video / audio clip ranges to their source material."""
        for list_name in ("video_segments", "audio_segments"):
            kept = []
            for index, segment in enumerate(getattr(timeline, list_name)):
                material = by_id[segment.material_id]
                label = report.label_of(segment, f"{list_name}[{index}]")
                if self._normalise_segment_range(
                    segment, material, label, report
                ):
                    kept.append(segment)
            setattr(timeline, list_name, kept)

    def _normalise_segment_range(
        self,
        segment: Any,
        material: MaterialItemModel,
        label: str,
        report: SanitizeReport,
    ) -> bool:
        """Normalise one clip range (INV-3); False when it must be dropped."""
        source = (
            material.duration
            if material.duration and material.duration > 0
            else None
        )
        clip_start = max(0.0, segment.clip_start or 0.0)
        if source is not None and clip_start >= source:
            report.dropped.append(
                f"{label}: clip_start {clip_start:.2f}s is past the "
                f"{source:.2f}s source of {segment.material_id}, dropped"
            )
            return False

        clip_end = segment.clip_end
        if clip_end is None or clip_end <= clip_start:
            # A missing or reversed end means "play `duration` from start".
            clip_end = clip_start + segment.duration
        if source is not None:
            clip_end = min(clip_end, source)
        available = clip_end - clip_start
        if available < MIN_SEGMENT_SECONDS <= segment.duration:
            report.dropped.append(
                f"{label}: only {available:.2f}s of {segment.material_id} "
                f"is left after clip_start {clip_start:.2f}s, dropped"
            )
            return False
        if available < segment.duration - OVERLAP_EPSILON:
            report.adjusted.append(
                f"{label}: {segment.material_id} shortened from "
                f"{segment.duration:.2f}s to the {available:.2f}s left in "
                "its source range"
            )
        segment.duration = min(segment.duration, available)
        segment.clip_start = clip_start
        segment.clip_end = clip_start + segment.duration
        return True

    def _clip_to_total(
        self, timeline: SimplifiedTimelineModel, report: SanitizeReport
    ) -> None:
        """Clamp starts to >= 0, clip to total_duration, drop too-short ones."""
        total_duration = timeline.total_duration
        for list_name in SEGMENT_LISTS:
            kept = []
            for index, segment in enumerate(getattr(timeline, list_name)):
                segment.start_time = max(0.0, segment.start_time)
                excess = segment.start_time + segment.duration - total_duration
                if excess > 0:
                    segment.duration = total_duration - segment.start_time
                    _sync_clip_end(segment)
                name = report.label_of(segment, f"{list_name}[{index}]")
                label = f"{name}: {segment.material_id}"
                if segment.duration < MIN_SEGMENT_SECONDS:
                    report.dropped.append(
                        f"{label} is shorter than {MIN_SEGMENT_SECONDS}s "
                        f"within the {total_duration:.2f}s timeline, dropped"
                    )
                    continue
                if excess > OVERLAP_EPSILON:
                    report.adjusted.append(
                        f"{label} trimmed by {excess:.2f}s to fit the "
                        f"{total_duration:.2f}s timeline"
                    )
                kept.append(segment)
            setattr(timeline, list_name, kept)

    def _canonicalise_audio_tracks(
        self, timeline: SimplifiedTimelineModel, report: SanitizeReport
    ) -> None:
        """Give every audio segment an ``audio-track-n`` lane (AM2-02).

        Models write "Audio Track 2", 2, "bgm", null or even "video-track-1".
        Left as-is these collide with the video track id in the parsed
        timeline or collapse narration and music onto one lane in the editor.
        Numbered names keep their number; other labels get the next unused
        lane in first-seen order; everything past MAX_AUDIO_LANES shares the
        last lane.
        """
        segments = timeline.audio_segments
        numbers = [_audio_track_number(segment.track) for segment in segments]
        used_numbers = {number for number in numbers if number is not None}
        label_numbers: Dict[str, int] = {}
        for index, (segment, number) in enumerate(zip(segments, numbers)):
            if number is None:
                number = _number_for_label(
                    segment.track, label_numbers, used_numbers
                )
            canonical = f"audio-track-{min(number, MAX_AUDIO_LANES)}"
            if segment.track != canonical:
                name = report.label_of(segment, f"audio_segments[{index}]")
                report.adjusted.append(
                    f"{name}: track {_describe_track(segment.track)} "
                    f"mapped to {canonical}"
                )
            segment.track = canonical

    def _pack_lanes(
        self, timeline: SimplifiedTimelineModel, report: SanitizeReport
    ) -> None:
        """Lay every lane flush from 0 in start order (AM2-01 / AM2-07).

        The editor re-packs every unlocked video / audio track (the image
        track included) on each structural edit. A plan with gaps would look
        right once and jump on the next unrelated edit, so the plan is packed
        here with the same rule. Packing also resolves overlaps without
        clipping anything: total_duration is recomputed afterwards.
        """
        lanes = [
            ("video_segments", timeline.video_segments),
            ("image_segments", timeline.image_segments),
            *(
                ("audio_segments", lane)
                for lane in _audio_segments_by_track(timeline.audio_segments)
            ),
        ]
        for list_name, segments in lanes:
            cursor = 0.0
            ordered = sorted(
                enumerate(segments),
                key=lambda pair: (pair[1].start_time, pair[0]),
            )
            for index, segment in ordered:
                if abs(segment.start_time - cursor) > OVERLAP_EPSILON:
                    name = report.label_of(segment, f"{list_name}[{index}]")
                    reason = (
                        "close a gap"
                        if segment.start_time > cursor
                        else "clear an overlap"
                    )
                    report.adjusted.append(
                        f"{name}: {segment.material_id} moved from "
                        f"{segment.start_time:.2f}s to {cursor:.2f}s "
                        f"to {reason}"
                    )
                segment.start_time = cursor
                cursor += segment.duration

    def _warn_past_video_end(
        self, timeline: SimplifiedTimelineModel, report: SanitizeReport
    ) -> None:
        """Report audio / image segments outlasting the video lane (AM2-06).

        Nothing is modified — the export renders such a tail black — but the
        prompt requires the video lane to be the longest, so a violation is
        surfaced instead of silently producing a black ending.
        """
        if not timeline.video_segments:
            return
        video_end = max(
            segment.start_time + segment.duration
            for segment in timeline.video_segments
        )
        for list_name in ("audio_segments", "image_segments"):
            for index, segment in enumerate(getattr(timeline, list_name)):
                end = segment.start_time + segment.duration
                if end <= video_end + OVERLAP_EPSILON:
                    continue
                name = report.label_of(segment, f"{list_name}[{index}]")
                report.adjusted.append(
                    f"{name}: {segment.material_id} ends at {end:.2f}s "
                    f"after the video lane ends at {video_end:.2f}s"
                )


def _all_segments(timeline: SimplifiedTimelineModel) -> List[Any]:
    """Every segment of the plan: video, then audio, then image."""
    return [
        *timeline.video_segments,
        *timeline.audio_segments,
        *timeline.image_segments,
    ]


def _sync_clip_end(segment: Any) -> None:
    """Keep ``duration == clip_end - clip_start`` for source-ranged segments."""
    if isinstance(segment, ImageSegmentModel):
        return
    segment.clip_end = (segment.clip_start or 0.0) + segment.duration


def _audio_track_number(track: Any) -> Optional[int]:
    """Lane number a track value names, or None for a free-form label.

    Missing values and video / image track ids fall back to lane 1; an
    integer or a name ending in a number ("Audio Track 2") keeps it.
    """
    if track is None:
        return 1
    if isinstance(track, bool):
        return None
    if isinstance(track, int):
        return max(1, track)
    text = str(track).strip()
    if not text or text.lower().startswith(_NON_AUDIO_TRACK_PREFIXES):
        return 1
    match = _TRAILING_NUMBER.search(text)
    return max(1, int(match.group(1))) if match else None


def _number_for_label(
    label: Any, label_numbers: Dict[str, int], used_numbers: Set[int]
) -> int:
    """Next unused lane for a free-form label; one lane per distinct label."""
    key = str(label).strip().lower()
    if key not in label_numbers:
        number = 1
        while number in used_numbers:
            number += 1
        used_numbers.add(number)
        label_numbers[key] = number
    return label_numbers[key]


def _describe_track(track: Any) -> str:
    """Track value as written in a sanitise warning ("bgm" quoted, 2 bare)."""
    return f'"{track}"' if isinstance(track, str) else repr(track)


def _audio_segments_by_track(
    audio_segments: List[AudioSegmentModel],
) -> List[List[AudioSegmentModel]]:
    """Audio segments grouped per track, tracks in first-seen order."""
    lanes: Dict[str, List[AudioSegmentModel]] = {}
    for segment in audio_segments:
        lanes.setdefault(str(segment.track), []).append(segment)
    return list(lanes.values())
