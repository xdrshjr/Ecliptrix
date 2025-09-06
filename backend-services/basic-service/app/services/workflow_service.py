"""
Workflow service for managing creative workflow configurations.
"""

import json
import os
from typing import List, Optional
from pathlib import Path
from app.models.workflow_models import WorkflowInfo, WorkflowNodeInfo
from app.logger import get_logger

logger = get_logger(__name__)


class WorkflowService:
    """
    Service for managing workflow configurations and operations.
    """
    
    def __init__(self):
        """Initialize the workflow service."""
        self.config_path = self._get_config_path()
        logger.info(f"WorkflowService initialized with config path: {self.config_path}")
    
    def _get_config_path(self) -> Path:
        """
        Get the path to the workflow configuration file.
        
        Returns:
            Path: Path to workflow-config.json
        """
        # Get the current file's directory and navigate to workflow config
        current_dir = Path(__file__).parent.parent.parent
        config_path = current_dir / "workflow" / "workflow-config.json"
        
        logger.debug(f"Workflow config path resolved to: {config_path}")
        return config_path
    
    async def get_available_workflows(self) -> List[WorkflowInfo]:
        """
        Get all available creative workflows from the configuration file.
        
        Returns:
            List[WorkflowInfo]: List of available workflows
            
        Raises:
            FileNotFoundError: If workflow config file is not found
            json.JSONDecodeError: If config file contains invalid JSON
            Exception: For other unexpected errors
        """
        try:
            logger.info("Loading available workflows from configuration file")
            
            if not self.config_path.exists():
                logger.error(f"Workflow configuration file not found at: {self.config_path}")
                raise FileNotFoundError(f"Workflow configuration file not found: {self.config_path}")
            
            # Read and parse the configuration file
            with open(self.config_path, 'r', encoding='utf-8') as file:
                config_data = json.load(file)
            
            logger.debug(f"Loaded {len(config_data)} workflow configurations from file")
            
            # Convert to WorkflowInfo objects
            workflows = []
            for workflow_data in config_data:
                try:
                    # Convert nodeInfoList to WorkflowNodeInfo objects
                    node_info_list = [
                        WorkflowNodeInfo(**node_info) 
                        for node_info in workflow_data.get('nodeInfoList', [])
                    ]
                    
                    # Create WorkflowInfo object
                    workflow = WorkflowInfo(
                        workflowName=workflow_data['workflowName'],
                        workflowType=workflow_data['workflowType'],
                        showNameCh=workflow_data['showNameCh'],
                        showNameEn=workflow_data['showNameEn'],
                        workflowId=workflow_data['workflowId'],
                        description=workflow_data['description'],
                        icon=workflow_data['icon'],
                        nodeInfoList=node_info_list
                    )
                    
                    workflows.append(workflow)
                    logger.debug(f"Successfully parsed workflow: {workflow.workflow_name}")
                    
                except Exception as e:
                    logger.error(f"Error parsing workflow {workflow_data.get('workflowName', 'unknown')}: {str(e)}")
                    continue
            
            logger.info(f"Successfully loaded {len(workflows)} workflows")
            return workflows
            
        except FileNotFoundError:
            logger.error("Workflow configuration file not found")
            raise
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in workflow configuration file: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error loading workflows: {str(e)}")
            raise
    
    async def get_workflow_by_id(self, workflow_id: str) -> Optional[WorkflowInfo]:
        """
        Get a specific workflow by its ID.
        
        Args:
            workflow_id: The workflow ID to search for
            
        Returns:
            Optional[WorkflowInfo]: The workflow if found, None otherwise
        """
        try:
            logger.info(f"Searching for workflow with ID: {workflow_id}")
            
            workflows = await self.get_available_workflows()
            
            for workflow in workflows:
                if workflow.workflow_id == workflow_id:
                    logger.info(f"Found workflow: {workflow.workflow_name}")
                    return workflow
            
            logger.warning(f"Workflow not found with ID: {workflow_id}")
            return None
            
        except Exception as e:
            logger.error(f"Error searching for workflow {workflow_id}: {str(e)}")
            raise
    
    async def validate_workflow_parameters(self, workflow_id: str, parameters: dict) -> bool:
        """
        Validate parameters against a workflow's node info list.
        
        Args:
            workflow_id: The workflow ID
            parameters: Dictionary of parameters to validate
            
        Returns:
            bool: True if parameters are valid, False otherwise
        """
        try:
            logger.info(f"Validating parameters for workflow: {workflow_id}")
            
            workflow = await self.get_workflow_by_id(workflow_id)
            if not workflow:
                logger.error(f"Cannot validate parameters: workflow {workflow_id} not found")
                return False
            
            # Check if all required node parameters are provided
            required_nodes = {node.node_id: node for node in workflow.node_info_list}
            
            for node_id, node_info in required_nodes.items():
                if node_id not in parameters:
                    logger.warning(f"Missing parameter for node {node_id} in workflow {workflow_id}")
                    # For now, we'll allow missing parameters (they'll use default values)
                    continue
            
            logger.info(f"Parameter validation successful for workflow: {workflow_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error validating parameters for workflow {workflow_id}: {str(e)}")
            return False


# Create a singleton instance
workflow_service = WorkflowService()