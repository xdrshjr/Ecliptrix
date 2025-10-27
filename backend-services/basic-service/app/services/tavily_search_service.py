"""
Tavily Search Service
Provides AI-powered web search functionality using Tavily API with automatic API key rotation.
"""

import os
import asyncio
from typing import List, Dict, Any, Optional
from app.logger import get_logger
import aiohttp

logger = get_logger(__name__)


class TavilySearchService:
    """
    Service for performing web searches using Tavily AI-powered search API.
    Features:
    - Multiple API key support with automatic rotation
    - Fallback mechanism when API calls fail
    - Detailed logging and error handling
    """
    
    def __init__(self):
        """Initialize Tavily Search Service with API keys from environment."""
        # Load API keys from environment
        api_keys_str = os.getenv('TAVILY_API_KEYS', '')
        self.api_keys: List[str] = [
            key.strip() 
            for key in api_keys_str.split(',') 
            if key.strip()
        ]
        
        # Current API key index for rotation
        self.current_key_index = 0
        
        # Tavily API endpoint
        self.api_url = "https://api.tavily.com/search"
        
        logger.info(f"TavilySearchService initialized with {len(self.api_keys)} API keys")
        
        if not self.api_keys:
            logger.warning("No Tavily API keys configured! Service will not work properly.")
    
    def _get_next_api_key(self) -> Optional[str]:
        """
        Get the next API key for rotation.
        
        Returns:
            str: Next API key, or None if no keys available
        """
        if not self.api_keys:
            logger.error("No API keys available")
            return None
        
        api_key = self.api_keys[self.current_key_index]
        self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
        
        logger.debug(f"Using API key index: {self.current_key_index - 1 if self.current_key_index > 0 else len(self.api_keys) - 1}")
        return api_key
    
    async def search(
        self, 
        query: str, 
        max_results: int = 5,
        search_depth: str = "basic",
        include_images: bool = False,
        include_answer: bool = False
    ) -> Dict[str, Any]:
        """
        Perform a web search using Tavily API with automatic API key rotation.
        
        Args:
            query: Search query string
            max_results: Maximum number of search results to return (1-50)
            search_depth: Search depth - "basic" or "advanced"
            include_images: Whether to include images in results
            include_answer: Whether to include AI-generated answer
            
        Returns:
            Dict containing search results with the following structure:
            {
                "success": bool,
                "query": str,
                "results": List[Dict],
                "total_results": int,
                "api_key_used": str (masked),
                "message": str
            }
            
        Raises:
            Exception: If all API keys fail or other errors occur
        """
        logger.info(f"Starting Tavily search with query: '{query}', max_results: {max_results}")
        
        if not query or not query.strip():
            logger.error("Empty search query provided")
            return {
                "success": False,
                "query": query,
                "results": [],
                "total_results": 0,
                "message": "Search query cannot be empty"
            }
        
        if not self.api_keys:
            logger.error("No Tavily API keys configured")
            return {
                "success": False,
                "query": query,
                "results": [],
                "total_results": 0,
                "message": "Tavily API keys not configured"
            }
        
        # Clamp max_results between 1 and 50
        max_results = max(1, min(50, max_results))
        
        # Try each API key until one succeeds
        errors = []
        for attempt in range(len(self.api_keys)):
            api_key = self._get_next_api_key()
            
            if not api_key:
                logger.error("Failed to get API key")
                continue
            
            # Mask API key for logging (show first 8 chars and last 4 chars)
            masked_key = f"{api_key[:8]}...{api_key[-4:]}" if len(api_key) > 12 else "***"
            
            logger.info(f"Attempt {attempt + 1}/{len(self.api_keys)} - Using API key: {masked_key}")
            
            try:
                # Prepare request payload
                payload = {
                    "api_key": api_key,
                    "query": query.strip(),
                    "max_results": max_results,
                    "search_depth": search_depth,
                    "include_images": include_images,
                    "include_answer": include_answer
                }
                
                logger.debug(f"Tavily API request payload: {payload}")
                
                # Make API request with timeout
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        self.api_url,
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=30)
                    ) as response:
                        response_text = await response.text()
                        
                        logger.debug(f"Tavily API response status: {response.status}")
                        logger.debug(f"Tavily API response body: {response_text[:500]}")
                        
                        if response.status == 200:
                            try:
                                data = await response.json()
                                
                                # Extract results
                                results = data.get('results', [])
                                answer = data.get('answer', '')
                                images = data.get('images', [])
                                
                                logger.info(f"Tavily search successful - Found {len(results)} results")
                                logger.debug(f"Search results: {results[:2]}")  # Log first 2 results
                                
                                return {
                                    "success": True,
                                    "query": query.strip(),
                                    "results": results,
                                    "total_results": len(results),
                                    "answer": answer if include_answer else None,
                                    "images": images if include_images else None,
                                    "api_key_used": masked_key,
                                    "message": f"Successfully found {len(results)} results"
                                }
                            except Exception as e:
                                logger.error(f"Failed to parse Tavily API response: {e}")
                                errors.append(f"API key {masked_key}: Failed to parse response - {str(e)}")
                                continue
                        else:
                            error_msg = f"API returned status {response.status}: {response_text[:200]}"
                            logger.warning(f"Tavily API error with key {masked_key}: {error_msg}")
                            errors.append(f"API key {masked_key}: {error_msg}")
                            continue
                            
            except asyncio.TimeoutError:
                error_msg = "Request timeout after 30 seconds"
                logger.error(f"Tavily API timeout with key {masked_key}: {error_msg}")
                errors.append(f"API key {masked_key}: {error_msg}")
                continue
                
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Tavily API error with key {masked_key}: {error_msg}")
                errors.append(f"API key {masked_key}: {error_msg}")
                continue
        
        # All API keys failed
        error_summary = "; ".join(errors)
        logger.error(f"All Tavily API keys failed. Errors: {error_summary}")
        
        return {
            "success": False,
            "query": query,
            "results": [],
            "total_results": 0,
            "message": f"All API keys failed. Errors: {error_summary}",
            "errors": errors
        }


# Create singleton instance
tavily_search_service = TavilySearchService()

