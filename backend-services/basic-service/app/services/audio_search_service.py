"""
Audio search service for Freesound API integration.
"""

import os
import requests
from typing import Optional, Dict, Any

from app.models.audio_search_models import AudioSearchResponse, AudioInfo
from app.logger import get_logger

logger = get_logger(__name__)


class AudioSearchService:
    """
    Service for searching audio files using Freesound API.
    
    This service handles:
    - Searching audio files by query
    - Filtering by duration
    - Processing API responses
    - Error handling and logging
    """
    
    def __init__(self):
        """Initialize the audio search service with API configuration."""
        # Get API key from environment variables
        self.api_key = os.getenv("FREESOUND_API_KEY")
        self.base_url = "https://freesound.org/apiv2"
        
        if not self.api_key:
            logger.warning("Freesound API key not configured. Audio search will not work.")
        else:
            logger.info("Audio search service initialized with Freesound API")
    
    def _make_api_request(self, endpoint: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Make a request to the Freesound API.
        
        Args:
            endpoint: API endpoint to call
            params: Query parameters
            
        Returns:
            API response data or None if failed
        """
        if not self.api_key:
            logger.error("Freesound API key not configured")
            return None
        
        # Add API key to parameters
        params['token'] = self.api_key
        
        url = f"{self.base_url}/{endpoint}"
        
        try:
            logger.info(f"Making Freesound API request to {endpoint}", extra={
                'url': url,
                'params': {k: v for k, v in params.items() if k != 'token'}  # Don't log API key
            })
            
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            logger.info(f"Freesound API request successful", extra={
                'endpoint': endpoint,
                'count': data.get('count', 0),
                'response_size': len(str(data))
            })
            
            return data
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Freesound API request failed: {str(e)}", extra={
                'endpoint': endpoint,
                'params': {k: v for k, v in params.items() if k != 'token'}
            })
            return None
        except Exception as e:
            logger.error(f"Unexpected error during Freesound API request: {str(e)}")
            return None
    
    def _convert_freesound_audio(self, audio_data: Dict[str, Any]) -> AudioInfo:
        """
        Convert Freesound API response to AudioInfo model.
        
        Args:
            audio_data: Raw audio data from Freesound API
            
        Returns:
            AudioInfo object
        """
        # Extract preview URLs - Freesound provides different quality previews
        previews = audio_data.get('previews', {})
        preview_url = previews.get('preview-lq-mp3', previews.get('preview-hq-mp3', ''))
        download_url = previews.get('preview-hq-mp3', preview_url)
        
        # Extract waveform images
        images = audio_data.get('images', {})
        waveform_url = images.get('waveform_m', images.get('waveform_l', None))
        
        # Extract tags
        tags = audio_data.get('tags', [])
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        elif not isinstance(tags, list):
            tags = []
        
        # Extract file information
        filesize = audio_data.get('filesize', 0)
        file_type = audio_data.get('type', 'mp3')
        channels = audio_data.get('channels', None)
        bitrate = audio_data.get('bitrate', None)
        samplerate = audio_data.get('samplerate', None)
        num_downloads = audio_data.get('num_downloads', 0)
        
        return AudioInfo(
            id=audio_data.get('id', 0),
            name=audio_data.get('name', 'Unknown'),
            description=audio_data.get('description', ''),
            username=audio_data.get('username', 'Unknown'),
            duration=float(audio_data.get('duration', 0)),
            download_url=download_url,
            preview_url=preview_url,
            waveform_url=waveform_url,
            license=audio_data.get('license', 'Unknown'),
            tags=tags,
            filesize=filesize,
            type=file_type,
            channels=channels,
            bitrate=bitrate,
            samplerate=samplerate,
            downloads=num_downloads
        )
    
    def search_audios(self, query: str, max_audios: int = 20, duration_min: Optional[float] = None, 
                     duration_max: Optional[float] = None, audio_type: str = "all", sort_by: str = "score") -> AudioSearchResponse:
        """
        Search for audio files using Freesound API.
        
        Args:
            query: Search query string
            max_audios: Maximum number of audio files to return
            duration_min: Minimum duration filter (seconds)
            duration_max: Maximum duration filter (seconds)
            audio_type: Audio type filter (all, music, sound-effect, speech, ambient, nature)
            sort_by: Sort order (score, downloads, rating, duration_desc, duration_asc, created_desc, created_asc)
            
        Returns:
            AudioSearchResponse: Search results
        """
        logger.info(f"Starting audio search", extra={
            'query': query,
            'max_audios': max_audios,
            'duration_min': duration_min,
            'duration_max': duration_max,
            'audio_type': audio_type,
            'sort_by': sort_by
        })
        
        if not self.api_key:
            error_message = "Freesound API key not configured"
            logger.error(error_message)
            return AudioSearchResponse(
                success=False,
                message=error_message,
                audios=[],
                total_found=0,
                query=query
            )
        
        # Build search parameters
        params = {
            'query': query,
            'page_size': min(max_audios, 150),  # Freesound API limit
            'fields': 'id,name,description,username,duration,previews,images,license,tags,filesize,type,channels,bitrate,samplerate,num_downloads',
            'sort': sort_by  # Add sort parameter
        }
        
        logger.info(f"Using sort parameter: {sort_by}", extra={
            'sort_by': sort_by,
            'query': query,
            'is_popularity_search': sort_by == 'downloads',
            'requested_fields': 'id,name,description,username,duration,previews,images,license,tags,filesize,type,channels,bitrate,samplerate,num_downloads'
        })
        
        # Add duration filter if specified
        filter_parts = []
        if duration_min is not None:
            filter_parts.append(f'duration:[{duration_min} TO *]')
        if duration_max is not None:
            filter_parts.append(f'duration:[* TO {duration_max}]')
        
        # Add audio type filter if specified
        if audio_type != "all":
            type_filters = {
                "music": "tag:music OR tag:musical OR tag:song OR tag:melody",
                "sound-effect": "tag:sound-effect OR tag:fx OR tag:effect OR tag:sfx",
                "speech": "tag:speech OR tag:voice OR tag:vocal OR tag:talk",
                "ambient": "tag:ambient OR tag:atmosphere OR tag:drone OR tag:pad",
                "nature": "tag:nature OR tag:natural OR tag:outdoor OR tag:environment"
            }
            if audio_type in type_filters:
                filter_parts.append(f'({type_filters[audio_type]})')
        
        if filter_parts:
            params['filter'] = ' AND '.join(filter_parts)
        
        # Make API request
        api_data = self._make_api_request('search/text/', params)
        if not api_data:
            error_message = "Failed to fetch data from Freesound API"
            logger.error(error_message)
            return AudioSearchResponse(
                success=False,
                message=error_message,
                audios=[],
                total_found=0,
                query=query
            )
        
        # Extract results
        results = api_data.get('results', [])
        total_count = api_data.get('count', 0)
        
        logger.info(f"Retrieved {len(results)} audio files from Freesound API", extra={
            'total_available': total_count,
            'query': query
        })
        
        if not results:
            message = f"No audio files found for query: '{query}'"
            logger.info(message)
            return AudioSearchResponse(
                success=True,
                message=message,
                audios=[],
                total_found=0,
                query=query
            )
        
        # Convert API results to AudioInfo objects
        audio_list = []
        for audio_data in results:
            try:
                audio_info = self._convert_freesound_audio(audio_data)
                audio_list.append(audio_info)
                
                logger.debug(f"Converted audio: {audio_info.name}", extra={
                    'audio_id': audio_info.id,
                    'duration': audio_info.duration,
                    'downloads': audio_info.downloads,
                    'tags': audio_info.tags[:3]  # Log first 3 tags only
                })
                
            except Exception as e:
                logger.warning(f"Failed to convert audio data: {str(e)}", extra={
                    'audio_data': audio_data.get('id', 'unknown')
                })
                continue
        
        success_message = f"Found {len(audio_list)} audio files"
        
        # Add popularity-specific logging if sorting by downloads
        popularity_stats = None
        if sort_by == 'downloads' and audio_list:
            downloads_list = [audio.downloads for audio in audio_list if audio.downloads is not None]
            if downloads_list:
                popularity_stats = {
                    'max_downloads': max(downloads_list),
                    'min_downloads': min(downloads_list),
                    'avg_downloads': sum(downloads_list) / len(downloads_list)
                }
        
        logger.info(f"Audio search completed successfully", extra={
            'found_count': len(audio_list),
            'total_available': total_count,
            'query': query,
            'sort_by': sort_by,
            'popularity_stats': popularity_stats
        })
        
        return AudioSearchResponse(
            success=True,
            message=success_message,
            audios=audio_list,
            total_found=total_count,
            query=query
        ) 