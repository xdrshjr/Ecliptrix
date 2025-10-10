"""
LLM service for managing and retrieving available LLM models configuration.
"""

import os
from typing import List, Optional
from app.models.llm_models import LLMModelInfo
from app.logger import get_logger

logger = get_logger(__name__)


class LLMService:
    """Service for managing LLM models configuration."""
    
    def __init__(self):
        """Initialize LLM service."""
        logger.info("LLMService initialized")
    
    def get_available_models(self) -> List[LLMModelInfo]:
        """
        Get all available LLM models from environment variables.
        
        Returns:
            List[LLMModelInfo]: List of available LLM models
        """
        logger.info("Retrieving available LLM models from environment variables")
        
        models = []
        
        # Parse AGENT_LLM_API_XX environment variables
        # Expected pattern: AGENT_LLM_API_01_KEY, AGENT_LLM_API_01_URL, AGENT_LLM_01_MODEL
        agent_model_numbers = []
        
        # Find all agent LLM configurations by checking for API keys
        for env_key in os.environ.keys():
            if env_key.startswith("AGENT_LLM_API_") and env_key.endswith("_KEY"):
                # Extract number from key like "AGENT_LLM_API_01_KEY" -> "01"
                parts = env_key.split("_")
                if len(parts) >= 4:
                    number = parts[3]  # Get the number part (01, 02, etc.)
                    if number not in agent_model_numbers:
                        agent_model_numbers.append(number)
        
        logger.info(f"Found {len(agent_model_numbers)} agent LLM configurations: {agent_model_numbers}")
        
        # Build model info for each found configuration
        for number in sorted(agent_model_numbers):
            api_key_env = f"AGENT_LLM_API_{number}_KEY"
            api_url_env = f"AGENT_LLM_API_{number}_URL"
            model_name_env = f"AGENT_LLM_{number}_MODEL"
            
            api_key = os.getenv(api_key_env, "")
            api_url = os.getenv(api_url_env, "")
            model_name = os.getenv(model_name_env, "")
            
            if api_key and api_url and model_name:
                # Mask API key for security (show only first 8 and last 4 characters)
                masked_key = self._mask_api_key(api_key)
                
                # Create model info
                model_info = LLMModelInfo(
                    id=f"agent_llm_{number}",
                    name=model_name,
                    api_url=api_url,
                    api_key=masked_key,
                    display_name=f"{model_name} (Agent {number})",
                    description=f"Agent LLM configuration {number}"
                )
                
                models.append(model_info)
                
                logger.debug(f"Added model: {model_info.display_name} - {model_info.name}")
            else:
                logger.warning(
                    f"Incomplete configuration for agent LLM {number}: "
                    f"key={bool(api_key)}, url={bool(api_url)}, model={bool(model_name)}"
                )
        
        logger.info(f"Successfully retrieved {len(models)} available LLM models")
        
        return models
    
    def _mask_api_key(self, api_key: str) -> str:
        """
        Mask API key for security.
        
        Args:
            api_key: Original API key
            
        Returns:
            str: Masked API key
        """
        if len(api_key) <= 12:
            # If key is too short, mask more aggressively
            return api_key[:4] + "*" * (len(api_key) - 4)
        else:
            # Show first 8 and last 4 characters
            return api_key[:8] + "*" * (len(api_key) - 12) + api_key[-4:]
    
    def get_model_by_id(self, model_id: str) -> Optional[LLMModelInfo]:
        """
        Get a specific LLM model by ID.
        
        Args:
            model_id: Model ID to retrieve
            
        Returns:
            Optional[LLMModelInfo]: Model info if found, None otherwise
        """
        logger.info(f"Retrieving LLM model by ID: {model_id}")
        
        models = self.get_available_models()
        
        for model in models:
            if model.id == model_id:
                logger.info(f"Found model: {model.display_name}")
                return model
        
        logger.warning(f"Model not found: {model_id}")
        return None


# Global LLM service instance
llm_service = LLMService()

