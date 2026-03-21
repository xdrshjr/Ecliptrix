"""
Image search service for Unsplash API integration.
"""

import os
import requests
from typing import Optional, Dict, Any

from app.models.image_search_models import ImageSearchResponse, ImageInfo
from app.logger import get_logger

logger = get_logger(__name__)


class ImageSearchService:
    """
    Service for searching images using Unsplash API.
    
    This service handles:
    - Searching images by query
    - Filtering by orientation and color
    - Processing API responses
    - Error handling and logging
    """
    
    def __init__(self):
        """Initialize the image search service with API configuration."""
        # Get API keys from environment variables (comma-separated list)
        api_keys_str = os.getenv("UNSPLASH_ACCESS_KEYS", "")
        self.api_keys = [key.strip() for key in api_keys_str.split(",") if key.strip()]
        self.current_key_index = 0
        self.base_url = "https://api.unsplash.com"
        
        if not self.api_keys:
            logger.warning("Unsplash API keys not configured. Image search will not work.")
        else:
            logger.info(f"Image search service initialized with {len(self.api_keys)} Unsplash API key(s)")
    
    def _get_current_api_key(self) -> Optional[str]:
        """Get the current API key for rotation."""
        if not self.api_keys:
            return None
        return self.api_keys[self.current_key_index]
    
    def _rotate_api_key(self):
        """Rotate to the next API key."""
        if len(self.api_keys) > 1:
            self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
            logger.info(f"Rotated to API key index {self.current_key_index}")
    
    def _make_api_request(self, endpoint: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Make a request to the Unsplash API with key rotation.
        
        Args:
            endpoint: API endpoint to call
            params: Query parameters
            
        Returns:
            API response data or None if failed
        """
        api_key = ***REMOVED***()
        if not api_key:
            logger.error("No Unsplash API key available")
            return None
        
        url = f"{self.base_url}/{endpoint}"
        headers = {
            'Authorization': f'Client-ID {api_key}',
            'Accept-Version': 'v1'
        }
        
        max_retries = len(self.api_keys)
        for attempt in range(max_retries):
            try:
                logger.info(f"Making Unsplash API request to {endpoint} (attempt {attempt + 1})", extra={
                    'url': url,
                    'params': params,
                    'key_index': self.current_key_index
                })
                
                response = requests.get(url, params=params, headers=headers, timeout=30)
                
                # Check for rate limiting
                if response.status_code == 403:
                    logger.warning(f"Rate limit hit for API key index {self.current_key_index}")
                    if attempt < max_retries - 1:
                        self._rotate_api_key()
                        api_key = ***REMOVED***()
                        headers['Authorization'] = f'Client-ID {api_key}'
                        continue
                
                response.raise_for_status()
                
                data = response.json()
                logger.info(f"Unsplash API request successful", extra={
                    'endpoint': endpoint,
                    'total': data.get('total', len(data) if isinstance(data, list) else 0),
                    'response_size': len(str(data)),
                    'key_index': self.current_key_index
                })
                
                return data
                
            except requests.exceptions.RequestException as e:
                logger.error(f"Unsplash API request failed (attempt {attempt + 1}): {str(e)}", extra={
                    'endpoint': endpoint,
                    'params': params,
                    'key_index': self.current_key_index
                })
                
                if attempt < max_retries - 1:
                    self._rotate_api_key()
                    api_key = ***REMOVED***()
                    headers['Authorization'] = f'Client-ID {api_key}'
                
            except Exception as e:
                logger.error(f"Unexpected error during Unsplash API request: {str(e)}")
                break
        
        return None
    
    def _convert_unsplash_image(self, image_data: Dict[str, Any]) -> ImageInfo:
        """
        Convert Unsplash API response to ImageInfo model.
        
        Args:
            image_data: Raw image data from Unsplash API
            
        Returns:
            ImageInfo object
        """
        # Extract URLs
        urls = image_data.get('urls', {})
        
        # Extract user information
        user = image_data.get('user', {})
        user_profile_image = user.get('profile_image', {})
        
        # Extract tags
        tags = []
        if 'tags' in image_data:
            tags = [tag.get('title', '') for tag in image_data['tags'] if tag.get('title')]
        
        # Extract categories (Unsplash doesn't have categories, use tags as fallback)
        categories = []
        if 'categories' in image_data:
            categories = [cat.get('title', '') for cat in image_data['categories'] if cat.get('title')]
        
        return ImageInfo(
            id=image_data.get('id', ''),
            description=image_data.get('description'),
            alt_description=image_data.get('alt_description'),
            width=image_data.get('width', 0),
            height=image_data.get('height', 0),
            color=image_data.get('color', '#000000'),
            blur_hash=image_data.get('blur_hash'),
            
            # URLs
            raw_url=urls.get('raw', ''),
            full_url=urls.get('full', ''),
            regular_url=urls.get('regular', ''),
            small_url=urls.get('small', ''),
            thumb_url=urls.get('thumb', ''),
            
            # User information
            user_id=user.get('id', ''),
            user_name=user.get('name', 'Unknown'),
            user_username=user.get('username', 'unknown'),
            user_profile_url=f"https://unsplash.com/@{user.get('username', 'unknown')}",
            user_avatar_url=user_profile_image.get('medium'),
            
            # Metadata
            likes=image_data.get('likes', 0),
            downloads=image_data.get('downloads', 0),
            created_at=image_data.get('created_at', ''),
            updated_at=image_data.get('updated_at', ''),
            
            # Tags and categories
            tags=tags,
            categories=categories,
            
            # Links
            html_url=image_data.get('links', {}).get('html', ''),
            download_location=image_data.get('links', {}).get('download_location', '')
        )
    
    def search_images(self, query: str, max_images: int = 60, orientation: str = "all", 
                     color: str = "all", order_by: str = "relevant") -> ImageSearchResponse:
        """
        Search for images using Unsplash API.
        
        Args:
            query: Search query string
            max_images: Maximum number of images to return (max 60)
            orientation: Image orientation filter (all, landscape, portrait, squarish)
            color: Image color filter (all, black_and_white, black, white, yellow, orange, red, purple, magenta, green, teal, blue)
            order_by: Sort order (relevant, latest, popular)
            
        Returns:
            ImageSearchResponse: Search results
        """
        logger.info(f"Starting image search", extra={
            'query': query,
            'max_images': max_images,
            'orientation': orientation,
            'color': color,
            'order_by': order_by
        })
        
        if not self.api_keys:
            error_message = "Unsplash API keys not configured"
            logger.error(error_message)
            return ImageSearchResponse(
                success=False,
                message=error_message,
                images=[],
                total_found=0,
                query=query
            )
        
        # Build search parameters
        params = {
            'query': query,
            'per_page': min(max_images, 30),  # Unsplash API limit per request
            'order_by': order_by
        }
        
        # Add orientation filter if specified
        if orientation != "all":
            params['orientation'] = orientation
        
        # Add color filter if specified
        if color != "all":
            params['color'] = color
        
        # Calculate number of pages needed
        per_page = params['per_page']
        total_pages = (max_images + per_page - 1) // per_page  # Ceiling division
        
        all_images = []
        total_found = 0
        
        # Make multiple requests if needed to get up to max_images
        for page in range(1, total_pages + 1):
            current_params = params.copy()
            current_params['page'] = page
            
            # Adjust per_page for the last page
            remaining_images = max_images - len(all_images)
            if remaining_images < per_page:
                current_params['per_page'] = remaining_images
            
            # Make API request
            api_data = self._make_api_request('search/photos', current_params)
            if not api_data:
                error_message = "Failed to fetch data from Unsplash API"
                logger.error(error_message)
                if page == 1:  # If first request fails, return error
                    return ImageSearchResponse(
                        success=False,
                        message=error_message,
                        images=[],
                        total_found=0,
                        query=query
                    )
                else:  # If subsequent request fails, return what we have
                    break
            
            # Extract results
            results = api_data.get('results', [])
            if page == 1:
                total_found = api_data.get('total', 0)
            
            logger.info(f"Retrieved {len(results)} images from Unsplash API (page {page})", extra={
                'page': page,
                'total_available': total_found,
                'query': query
            })
            
            if not results:
                break
            
            # Convert API results to ImageInfo objects
            for image_data in results:
                try:
                    image_info = self._convert_unsplash_image(image_data)
                    all_images.append(image_info)
                    
                    logger.debug(f"Converted image: {image_info.id}", extra={
                        'image_id': image_info.id,
                        'width': image_info.width,
                        'height': image_info.height,
                        'likes': image_info.likes,
                        'user': image_info.user_username
                    })
                    
                except Exception as e:
                    logger.warning(f"Failed to convert image data: {str(e)}", extra={
                        'image_data': image_data.get('id', 'unknown')
                    })
                    continue
            
            # Stop if we have enough images
            if len(all_images) >= max_images:
                break
        
        if not all_images:
            message = f"No images found for query: '{query}'"
            logger.info(message)
            return ImageSearchResponse(
                success=True,
                message=message,
                images=[],
                total_found=0,
                query=query
            )
        
        success_message = f"Found {len(all_images)} images"
        
        logger.info(f"Image search completed successfully", extra={
            'found_count': len(all_images),
            'total_available': total_found,
            'query': query,
            'order_by': order_by,
            'orientation': orientation,
            'color': color
        })
        
        return ImageSearchResponse(
            success=True,
            message=success_message,
            images=all_images,
            total_found=total_found,
            query=query
        ) 