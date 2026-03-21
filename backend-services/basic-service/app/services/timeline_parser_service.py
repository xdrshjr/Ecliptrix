"""
Timeline Parser Service for converting simplified AI editing responses to full timeline format.
Handles the conversion from simplified JSON structure to complete timeline JSON.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional
from app.logger import get_logger
from app.models.ai_mixed_editing_models import (
    SimplifiedTimelineModel,
    VideoSegmentModel, 
    AudioSegmentModel,
    ImageSegmentModel,
    MaterialItemModel
)

logger = get_logger(__name__)


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
                "volume": segment.volume / 100.0,  # Convert percentage to decimal
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
            "volume": 200,
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
                    "volume": 200,
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
        task_id: str
    ) -> Dict[str, Any]:
        """
        Parse simplified timeline to full timeline format.
        
        Args:
            simplified_timeline: Simplified timeline data
            materials: List of available materials
            task_id: Task identifier
            
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
        Automatically clips segments that exceed total duration.
        
        Args:
            simplified_timeline: Simplified timeline data to validate
            
        Returns:
            bool: True if valid, False otherwise
        """
        try:
            # Tolerance for floating-point precision (0.1 seconds)
            TOLERANCE = 0.1
            
            # Check if total duration is positive
            if simplified_timeline.total_duration <= 0:
                self.logger.error("Invalid total duration: must be positive")
                return False
            
            # Check and clip video segments that exceed total duration
            for segment in simplified_timeline.video_segments:
                segment_end_time = segment.start_time + segment.duration
                if segment_end_time > simplified_timeline.total_duration:
                    excess = segment_end_time - simplified_timeline.total_duration
                    
                    # Clip the segment to fit within total duration
                    new_duration = simplified_timeline.total_duration - segment.start_time
                    
                    if excess > TOLERANCE:
                        self.logger.warning(
                            f"Video segment exceeds total duration by {excess:.3f}s, clipping: "
                            f"{segment.material_id} (duration: {segment.duration:.3f}s -> {new_duration:.3f}s)"
                        )
                    else:
                        self.logger.debug(
                            f"Video segment slightly exceeds total duration (within tolerance), clipping: "
                            f"{segment.material_id}"
                        )
                    
                    segment.duration = max(0.0, new_duration)
                    
            for segment in simplified_timeline.audio_segments:
                segment_end_time = segment.start_time + segment.duration
                if segment_end_time > simplified_timeline.total_duration:
                    excess = segment_end_time - simplified_timeline.total_duration
                    
                    # Clip the segment to fit within total duration
                    new_duration = simplified_timeline.total_duration - segment.start_time
                    
                    if excess > TOLERANCE:
                        self.logger.warning(
                            f"Audio segment exceeds total duration by {excess:.3f}s, clipping: "
                            f"{segment.material_id} (duration: {segment.duration:.3f}s -> {new_duration:.3f}s)"
                        )
                    else:
                        self.logger.debug(
                            f"Audio segment slightly exceeds total duration (within tolerance), clipping: "
                            f"{segment.material_id}"
                        )
                    
                    segment.duration = max(0.0, new_duration)
                    
            for segment in simplified_timeline.image_segments:
                segment_end_time = segment.start_time + segment.duration
                if segment_end_time > simplified_timeline.total_duration:
                    excess = segment_end_time - simplified_timeline.total_duration
                    
                    # Clip the segment to fit within total duration
                    new_duration = simplified_timeline.total_duration - segment.start_time
                    
                    if excess > TOLERANCE:
                        self.logger.warning(
                            f"Image segment exceeds total duration by {excess:.3f}s, clipping: "
                            f"{segment.material_id} (duration: {segment.duration:.3f}s -> {new_duration:.3f}s)"
                        )
                    else:
                        self.logger.debug(
                            f"Image segment slightly exceeds total duration (within tolerance), clipping: "
                            f"{segment.material_id}"
                        )
                    
                    segment.duration = max(0.0, new_duration)
            
            self.logger.info("Simplified timeline validation passed")
            return True
            
        except Exception as e:
            self.logger.error(f"Timeline validation error: {str(e)}", exc_info=True)
            return False