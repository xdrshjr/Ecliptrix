"""
Tavily Search API Models
Pydantic models for Tavily search requests and responses.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, validator


class TavilySearchRequest(BaseModel):
    """Request model for Tavily search."""
    
    keywords: str = Field(..., description="Search keywords/query", min_length=1)
    count: int = Field(default=5, description="Number of search results to return", ge=1, le=50)
    search_depth: str = Field(default="basic", description="Search depth: 'basic' or 'advanced'")
    include_images: bool = Field(default=False, description="Whether to include images in results")
    include_answer: bool = Field(default=False, description="Whether to include AI-generated answer")
    
    @validator('keywords')
    def validate_keywords(cls, v):
        """Validate keywords are not empty."""
        if not v or not v.strip():
            raise ValueError('Keywords cannot be empty')
        return v.strip()
    
    @validator('search_depth')
    def validate_search_depth(cls, v):
        """Validate search depth is either 'basic' or 'advanced'."""
        if v not in ['basic', 'advanced']:
            raise ValueError('Search depth must be either "basic" or "advanced"')
        return v
    
    class Config:
        schema_extra = {
            "example": {
                "keywords": "artificial intelligence trends 2024",
                "count": 5,
                "search_depth": "basic",
                "include_images": False,
                "include_answer": False
            }
        }


class TavilySearchResult(BaseModel):
    """Model for a single Tavily search result."""
    
    title: str = Field(..., description="Title of the search result")
    url: str = Field(..., description="URL of the search result")
    content: str = Field(..., description="Content snippet from the search result")
    score: Optional[float] = Field(None, description="Relevance score of the result")
    
    class Config:
        schema_extra = {
            "example": {
                "title": "AI Trends in 2024",
                "url": "https://example.com/ai-trends-2024",
                "content": "Artificial intelligence continues to evolve with new trends...",
                "score": 0.95
            }
        }


class TavilySearchResponse(BaseModel):
    """Response model for Tavily search."""
    
    success: bool = Field(..., description="Whether the search was successful")
    message: str = Field(..., description="Response message")
    query: str = Field(..., description="The search query that was executed")
    results: List[TavilySearchResult] = Field(default=[], description="List of search results")
    total_results: int = Field(..., description="Total number of results returned")
    answer: Optional[str] = Field(None, description="AI-generated answer (if requested)")
    images: Optional[List[str]] = Field(None, description="List of image URLs (if requested)")
    api_key_used: Optional[str] = Field(None, description="Masked API key that was used")
    errors: Optional[List[str]] = Field(None, description="List of errors if any occurred")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "Successfully found 5 results",
                "query": "artificial intelligence trends 2024",
                "results": [
                    {
                        "title": "AI Trends in 2024",
                        "url": "https://example.com/ai-trends-2024",
                        "content": "Artificial intelligence continues to evolve...",
                        "score": 0.95
                    }
                ],
                "total_results": 5,
                "answer": None,
                "images": None,
                "api_key_used": "tvly-dev...xpA"
            }
        }


class NodeTestRequest(BaseModel):
    """Request model for testing workflow nodes."""
    
    node_id: str = Field(..., description="ID of the node to test")
    node_type: str = Field(..., description="Type of the node")
    node_label: str = Field(..., description="Label/name of the node")
    node_config: Dict[str, Any] = Field(..., description="Configuration of the node")
    input: Dict[str, Any] = Field(..., description="Input data for the node")
    
    class Config:
        schema_extra = {
            "example": {
                "node_id": "node-123456",
                "node_type": "tavily-search",
                "node_label": "Tavily Search",
                "node_config": {
                    "keywords": "AI trends",
                    "count": 5
                },
                "input": {
                    "keywords": "artificial intelligence 2024"
                }
            }
        }


class NodeTestResponse(BaseModel):
    """Response model for node testing."""
    
    success: bool = Field(..., description="Whether the test was successful")
    message: str = Field(default="", description="Response message")
    output: Dict[str, Any] = Field(..., description="Output data from the node")
    error: Optional[str] = Field(None, description="Error message if test failed")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "Node test completed successfully",
                "output": {
                    "results": [
                        {
                            "title": "AI Trends",
                            "url": "https://example.com",
                            "content": "Content..."
                        }
                    ],
                    "count": 5
                },
                "error": None
            }
        }

