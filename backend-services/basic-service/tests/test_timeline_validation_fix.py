"""
Test suite for Timeline Validation Fix.
Tests the automatic clipping functionality for segments that exceed total duration.
"""

import pytest
from app.services.timeline_parser_service import TimelineParserService
from app.models.ai_mixed_editing_models import (
    SimplifiedTimelineModel,
    VideoSegmentModel,
    AudioSegmentModel,
    ImageSegmentModel
)


class TestTimelineValidationFix:
    """Test timeline validation with automatic segment clipping."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.parser_service = TimelineParserService()
    
    def test_valid_timeline_passes_validation(self):
        """Test that a valid timeline passes validation without modifications."""
        timeline = SimplifiedTimelineModel(
            total_duration=10.0,
            video_segments=[
                VideoSegmentModel(
                    material_id="video-1",
                    start_time=0.0,
                    duration=5.0,
                    volume=1.0
                ),
                VideoSegmentModel(
                    material_id="video-2",
                    start_time=5.0,
                    duration=5.0,
                    volume=1.0
                )
            ],
            audio_segments=[
                AudioSegmentModel(
                    material_id="audio-1",
                    start_time=0.0,
                    duration=10.0,
                    volume=0.8
                )
            ],
            image_segments=[]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        assert timeline.video_segments[0].duration == 5.0
        assert timeline.video_segments[1].duration == 5.0
        assert timeline.audio_segments[0].duration == 10.0
    
    def test_audio_segment_exceeds_duration_gets_clipped(self):
        """Test that audio segment exceeding total duration gets automatically clipped."""
        timeline = SimplifiedTimelineModel(
            total_duration=10.0,
            video_segments=[],
            audio_segments=[
                AudioSegmentModel(
                    material_id="audio_segment-2_1761667083330",
                    start_time=0.0,
                    duration=12.5,  # Exceeds total duration by 2.5 seconds
                    volume=0.8
                )
            ],
            image_segments=[]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        # Should be clipped to 10.0 seconds
        assert timeline.audio_segments[0].duration == 10.0
    
    def test_video_segment_exceeds_duration_gets_clipped(self):
        """Test that video segment exceeding total duration gets automatically clipped."""
        timeline = SimplifiedTimelineModel(
            total_duration=15.0,
            video_segments=[
                VideoSegmentModel(
                    material_id="video-1",
                    start_time=10.0,
                    duration=8.0,  # Exceeds total duration by 3.0 seconds
                    volume=1.0
                )
            ],
            audio_segments=[],
            image_segments=[]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        # Should be clipped to 5.0 seconds (15.0 - 10.0)
        assert timeline.video_segments[0].duration == 5.0
    
    def test_image_segment_exceeds_duration_gets_clipped(self):
        """Test that image segment exceeding total duration gets automatically clipped."""
        timeline = SimplifiedTimelineModel(
            total_duration=20.0,
            video_segments=[],
            audio_segments=[],
            image_segments=[
                ImageSegmentModel(
                    material_id="image-1",
                    start_time=18.0,
                    duration=5.0  # Exceeds total duration by 3.0 seconds
                )
            ]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        # Should be clipped to 2.0 seconds (20.0 - 18.0)
        assert timeline.image_segments[0].duration == 2.0
    
    def test_small_tolerance_exceeds_within_threshold(self):
        """Test that segments exceeding by a small amount (within tolerance) are clipped."""
        timeline = SimplifiedTimelineModel(
            total_duration=10.0,
            video_segments=[
                VideoSegmentModel(
                    material_id="video-1",
                    start_time=0.0,
                    duration=10.05,  # Exceeds by 0.05 seconds (within 0.1 tolerance)
                    volume=1.0
                )
            ],
            audio_segments=[],
            image_segments=[]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        # Should be clipped to exactly 10.0 seconds
        assert timeline.video_segments[0].duration == 10.0
    
    def test_multiple_segments_all_get_clipped(self):
        """Test that multiple segments exceeding duration all get clipped."""
        timeline = SimplifiedTimelineModel(
            total_duration=30.0,
            video_segments=[
                VideoSegmentModel(
                    material_id="video-1",
                    start_time=0.0,
                    duration=15.0,
                    volume=1.0
                ),
                VideoSegmentModel(
                    material_id="video-2",
                    start_time=15.0,
                    duration=20.0,  # Exceeds by 5.0 seconds
                    volume=1.0
                )
            ],
            audio_segments=[
                AudioSegmentModel(
                    material_id="audio-1",
                    start_time=25.0,
                    duration=10.0,  # Exceeds by 5.0 seconds
                    volume=0.8
                )
            ],
            image_segments=[
                ImageSegmentModel(
                    material_id="image-1",
                    start_time=28.0,
                    duration=5.0  # Exceeds by 3.0 seconds
                )
            ]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        # Check all segments were clipped appropriately
        assert timeline.video_segments[0].duration == 15.0  # Unchanged
        assert timeline.video_segments[1].duration == 15.0  # Clipped from 20.0
        assert timeline.audio_segments[0].duration == 5.0   # Clipped from 10.0
        assert timeline.image_segments[0].duration == 2.0   # Clipped from 5.0
    
    def test_segment_starting_at_total_duration_is_removed(self):
        """A segment starting exactly at total duration would be 0s long: removed."""
        timeline = SimplifiedTimelineModel(
            total_duration=10.0,
            video_segments=[
                VideoSegmentModel(
                    material_id="video-1",
                    start_time=10.0,  # Starts at total duration
                    duration=5.0,
                    volume=1.0
                )
            ],
            audio_segments=[],
            image_segments=[]
        )

        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        assert timeline.video_segments == []

    def test_segment_starting_after_total_duration_is_removed(self):
        """A segment starting after total duration has no room left: removed."""
        timeline = SimplifiedTimelineModel(
            total_duration=10.0,
            video_segments=[],
            audio_segments=[
                AudioSegmentModel(
                    material_id="audio-1",
                    start_time=12.0,  # Starts after total duration
                    duration=3.0,
                    volume=0.8
                )
            ],
            image_segments=[]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        assert timeline.audio_segments == []
    
    def test_invalid_total_duration_fails_validation(self):
        """Test that invalid total duration (zero or negative) fails validation."""
        timeline = SimplifiedTimelineModel(
            total_duration=0.0,
            video_segments=[],
            audio_segments=[],
            image_segments=[]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is False
        
        timeline.total_duration = -5.0
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is False
    
    def test_exact_fit_segments_unchanged(self):
        """Test that segments that fit exactly are not modified."""
        timeline = SimplifiedTimelineModel(
            total_duration=20.0,
            video_segments=[
                VideoSegmentModel(
                    material_id="video-1",
                    start_time=0.0,
                    duration=10.0,
                    volume=1.0
                ),
                VideoSegmentModel(
                    material_id="video-2",
                    start_time=10.0,
                    duration=10.0,  # Fits exactly
                    volume=1.0
                )
            ],
            audio_segments=[],
            image_segments=[]
        )
        
        result = self.parser_service.validate_simplified_timeline(timeline)
        assert result is True
        # Durations should remain unchanged
        assert timeline.video_segments[0].duration == 10.0
        assert timeline.video_segments[1].duration == 10.0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])

