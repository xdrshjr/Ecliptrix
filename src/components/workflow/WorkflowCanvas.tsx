'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { WorkflowNode, WorkflowConnection, WorkflowNodePosition, ChatLLMNodeConfig, TextInputNodeConfig, StartNodeConfig, PexelsVideoSearchNodeConfig, TavilySearchNodeConfig, VolcanoTTSNodeConfig, ToArrayNodeConfig, ResultsCombineNodeConfig, AIVideoGenerateNodeConfig, VideoExportNodeConfig, WorkflowNodeExecutionState } from '@/types';
import ChatLLMNode from './nodes/ChatLLMNode';
import StartNode from './nodes/StartNode';
import EndNode from './nodes/EndNode';
import TextInputNode from './nodes/TextInputNode';
import PexelsVideoSearchNode from './nodes/PexelsVideoSearchNode';
import TavilySearchNode from './nodes/TavilySearchNode';
import VolcanoTTSNode from './nodes/VolcanoTTSNode';
import ToArrayNode from './nodes/ToArrayNode';
import ResultsCombineNode from './nodes/ResultsCombineNode';
import AIVideoGenerateNode from './nodes/AIVideoGenerateNode';
import VideoExportNode from './nodes/VideoExportNode';
import ChatLLMConfigPanel from './ChatLLMConfigPanel';
import TextInputConfigPanel from './TextInputConfigPanel';
import StartNodeConfigPanel from './StartNodeConfigPanel';
import PexelsVideoSearchConfigPanel from './PexelsVideoSearchConfigPanel';
import TavilySearchConfigPanel from './TavilySearchConfigPanel';
import VolcanoTTSConfigPanel from './VolcanoTTSConfigPanel';
import ToArrayConfigPanel from './ToArrayConfigPanel';
import ResultsCombineConfigPanel from './ResultsCombineConfigPanel';
import AIVideoGenerateConfigPanel from './AIVideoGenerateConfigPanel';
import VideoExportConfigPanel from './VideoExportConfigPanel';

interface WorkflowCanvasProps {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  onNodesChange: (nodes: WorkflowNode[]) => void;
  onConnectionsChange: (connections: WorkflowConnection[]) => void;
  onNodesAndConnectionsChange?: (nodes: WorkflowNode[], connections: WorkflowConnection[]) => void;
  nodeExecutionStates?: Record<string, WorkflowNodeExecutionState>;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
}

/**
 * Workflow Canvas Component
 * Provides a drag-and-drop canvas for creating and managing workflow nodes
 */
const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  nodes,
  connections,
  onNodesChange,
  onConnectionsChange,
  onNodesAndConnectionsChange,
  nodeExecutionStates = {},
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [canvasOffset, setCanvasOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [canvasDragStart, setCanvasDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  
  // Config panel state
  const [configPanelNodeId, setConfigPanelNodeId] = useState<string | null>(null);
  
  // Connection drawing state
  const [connectingPort, setConnectingPort] = useState<{
    nodeId: string;
    portType: 'input' | 'output';
    portId: string;
    x: number;
    y: number;
  } | null>(null);
  const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
  
  // Force re-render connections when nodes move
  const [connectionRenderKey, setConnectionRenderKey] = useState(0);
  
  // 用于优化拖动性能的临时位置存储
  const dragPositionRef = useRef<{ [key: string]: { x: number; y: number } }>({});
  const rafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const lastMousePositionRef = useRef<{ x: number; y: number } | null>(null);
  const hasMovedRef = useRef(false); // 标记是否真正发生了移动

  console.log('[WorkflowCanvas] Rendering canvas:', {
    nodesCount: nodes.length,
    connectionsCount: connections.length,
    selectedNodeId,
    selectedConnectionId,
    scale,
    isPanMode,
    isDraggingCanvas,
    connectingPort: connectingPort ? 'active' : 'none',
    timestamp: new Date().toISOString()
  });

  // Helper function to get port position based on node position
  const getPortPosition = useCallback((nodeId: string, portId: string, portType: 'input' | 'output') => {
    // Try to get port position from DOM first (most accurate)
    const portElement = document.querySelector(
      `[data-node-id="${nodeId}"][data-port-id="${portId}"]`
    ) as HTMLElement;
    
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    
    if (portElement && canvasRect) {
      const portRect = portElement.getBoundingClientRect();
      const portCenterX = portRect.left + portRect.width / 2 - canvasRect.left;
      const portCenterY = portRect.top + portRect.height / 2 - canvasRect.top;
      
      // Log port position for debugging
      // console.log('[WorkflowCanvas] Port position from DOM:', { 
      //   nodeId, 
      //   portId, 
      //   x: portCenterX, 
      //   y: portCenterY 
      // });
      
      return {
        x: portCenterX,
        y: portCenterY,
      };
    }
    
    // Fallback: calculate based on node position (for rendering before DOM is ready)
    const node = nodes.find(n => n.id === nodeId);
    if (!node) {
      console.warn('[WorkflowCanvas] Node not found for port position:', { nodeId });
      return null;
    }
    
    // Get node's current position (including any drag position)
    const position = draggingNode?.id === nodeId && dragPositionRef.current[nodeId]
      ? dragPositionRef.current[nodeId]
      : node.position;
    
    // Calculate node position on canvas
    const nodeX = (position.x + canvasOffset.x) * scale;
    const nodeY = (position.y + canvasOffset.y) * scale;
    
    // Estimate port offset based on node type and port type
    let portOffsetX = 0;
    let portOffsetY = 0;
    
    if (node.type === 'start') {
      // Start node: output on the right
      portOffsetX = 172 * scale; // node width minus padding
      portOffsetY = 58 * scale;  // approximate vertical center
    } else if (node.type === 'end') {
      // End node: input on the left
      portOffsetX = 8 * scale;   // left padding
      portOffsetY = 38 * scale;  // approximate vertical center
    } else if (node.type === 'chat-llm') {
      // Chat LLM node: input on left, output on right
      if (portType === 'input') {
        portOffsetX = 8 * scale;   // left padding
        portOffsetY = 54 * scale;  // top of body section
      } else {
        portOffsetX = 192 * scale; // node width minus padding
        portOffsetY = 114 * scale; // near bottom
      }
    }
    
    return {
      x: nodeX + portOffsetX,
      y: nodeY + portOffsetY,
    };
  }, [nodes, draggingNode, canvasOffset, scale]);

  // Helper function to create SVG path for connection
  const createConnectionPath = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    // Use bezier curve for smooth connections
    const controlPointOffset = Math.abs(dx) * 0.5;
    
    return `M ${x1},${y1} C ${x1 + controlPointOffset},${y1} ${x2 - controlPointOffset},${y2} ${x2},${y2}`;
  }, []);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      console.log('[WorkflowCanvas] Context menu opened:', { x, y });
      setContextMenu({ visible: true, x, y });
    }
  }, []);

  // Add Start node
  const handleAddStartNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'start',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Start',
        type: 'start',
      },
    };

    console.log('[WorkflowCanvas] Adding new Start node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add End node
  const handleAddEndNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'end',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'End',
        type: 'end',
      },
    };

    console.log('[WorkflowCanvas] Adding new End node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add Chat LLM node
  const handleAddChatLLMNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'chat-llm',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Chat LLM',
        type: 'chat-llm',
        config: {
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new Chat LLM node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add Text Input node
  const handleAddTextInputNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'text-input',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Text Input',
        type: 'text-input',
        config: {
          content: '',
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new Text Input node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add Pexels Video Search node
  const handleAddPexelsVideoSearchNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'pexels-video-search',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Pexels Video Search',
        type: 'pexels-video-search',
        config: {
          keywords: '',
          count: 5,
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new Pexels Video Search node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add Tavily Search node
  const handleAddTavilySearchNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'tavily-search',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Tavily Search',
        type: 'tavily-search',
        config: {
          keywords: '',
          count: 5,
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new Tavily Search node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add Volcano TTS node
  const handleAddVolcanoTTSNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'volcano-tts',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Volcano TTS',
        type: 'volcano-tts',
        config: {
          text: '',
          voiceType: 'zh_male_shaonianzixin_moon_bigtts',
          speedRatio: 1.0,
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new Volcano TTS node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add To Array node
  const handleAddToArrayNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'to-array',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'To Array',
        type: 'to-array',
        config: {
          systemPrompt: 'You are a data conversion assistant. Convert the input data into a clean JSON array format. Extract relevant items from the input and structure them as an array. Respond ONLY with a valid JSON array, no additional text or explanation.',
          temperature: 0.3,
          maxTokens: 2000,
          outputFormat: 'array',
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new To Array node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add Results Combine node
  const handleAddResultsCombineNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'results-combine',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Results Combine',
        type: 'results-combine',
        config: {
          systemPrompt: 'You are a data standardization assistant. Transform the input data into a standardized format according to the defined schema. Extract and normalize relevant information. Respond ONLY with a valid JSON object matching the schema, no additional text or explanation.',
          temperature: 0.3,
          maxTokens: 2000,
          inputFormat: 'array',
          outputFormat: 'array',
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new Results Combine node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add AI Video Generate node
  const handleAddAIVideoGenerateNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'ai-video-generate',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'AI Video Generate',
        type: 'ai-video-generate',
        config: {
          textInput: '',
          videoInput: '',
          audioInput: '',
          imageInput: '',
          textInputFormat: 'text/plain',
          videoInputFormat: 'text/plain',
          audioInputFormat: 'text/plain',
          imageInputFormat: 'text/plain',
          temperature: 0.7,
          maxTokens: 2000,
          outputFormat: 'application/json',
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new AI Video Generate node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Add Video Export node
  const handleAddVideoExportNode = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: 'video-export',
      position: {
        x: contextMenu.x / scale - canvasOffset.x,
        y: contextMenu.y / scale - canvasOffset.y,
      },
      data: {
        label: 'Video Export',
        type: 'video-export',
        config: {
          videoUrls: '',
          inputFormat: 'array',
          outputFormat: 'application/json',
        },
      },
    };

    console.log('[WorkflowCanvas] Adding new Video Export node:', {
      nodeId: newNode.id,
      position: newNode.position
    });

    onNodesChange([...nodes, newNode]);
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [contextMenu, nodes, onNodesChange, scale, canvasOffset]);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        console.log('[WorkflowCanvas] Closing context menu');
        setContextMenu({ visible: false, x: 0, y: 0 });
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu.visible]);

  // Handle node selection
  const handleNodeClick = useCallback((nodeId: string) => {
    console.log('[WorkflowCanvas] Node selected:', { nodeId });
    setSelectedNodeId(nodeId);
  }, []);

  // Handle node double click
  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    console.log('[WorkflowCanvas] Node double clicked:', { nodeId });
    
    // Check if the clicked node supports configuration
    const node = nodes.find(n => n.id === nodeId);
    if (node && (node.type === 'chat-llm' || node.type === 'text-input' || node.type === 'start' || node.type === 'pexels-video-search' || node.type === 'tavily-search' || node.type === 'volcano-tts' || node.type === 'to-array' || node.type === 'results-combine' || node.type === 'ai-video-generate' || node.type === 'video-export')) {
      console.log('[WorkflowCanvas] Opening config panel for node:', { 
        nodeId, 
        nodeType: node.type 
      });
      setConfigPanelNodeId(nodeId);
    }
  }, [nodes]);

  // Handle config save
  const handleConfigSave = useCallback((config: ChatLLMNodeConfig | TextInputNodeConfig | StartNodeConfig | PexelsVideoSearchNodeConfig | TavilySearchNodeConfig | VolcanoTTSNodeConfig | ToArrayNodeConfig | ResultsCombineNodeConfig | AIVideoGenerateNodeConfig | VideoExportNodeConfig) => {
    if (!configPanelNodeId) return;
    
    const node = nodes.find(n => n.id === configPanelNodeId);
    console.log('[WorkflowCanvas] Saving config for node:', { 
      nodeId: configPanelNodeId,
      nodeType: node?.type,
      config 
    });
    
    const updatedNodes = nodes.map(node => {
      if (node.id === configPanelNodeId) {
        return {
          ...node,
          data: {
            ...node.data,
            config,
          },
        };
      }
      return node;
    });
    
    onNodesChange(updatedNodes);
    console.log('[WorkflowCanvas] Config saved successfully');
  }, [configPanelNodeId, nodes, onNodesChange]);

  // Handle config panel close
  const handleConfigPanelClose = useCallback(() => {
    console.log('[WorkflowCanvas] Closing config panel');
    setConfigPanelNodeId(null);
  }, []);

  // Handle connection selection
  const handleConnectionClick = useCallback((connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[WorkflowCanvas] Connection selected:', { connectionId });
    setSelectedConnectionId(connectionId);
    setSelectedNodeId(null); // Deselect any selected node
  }, []);

  // Handle connection deletion
  const handleDeleteConnection = useCallback((connectionId: string) => {
    console.log('[WorkflowCanvas] Deleting connection:', { connectionId });
    const updatedConnections = connections.filter(conn => conn.id !== connectionId);
    onConnectionsChange(updatedConnections);
    setSelectedConnectionId(null);
    console.log('[WorkflowCanvas] Connection deleted successfully');
  }, [connections, onConnectionsChange]);

  // Handle port mouse down (start connection)
  const handlePortMouseDown = useCallback((
    nodeId: string, 
    portType: 'input' | 'output', 
    portId: string, 
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Get port element position
    const portElement = event.currentTarget as HTMLElement;
    const portRect = portElement.getBoundingClientRect();
    const portCenterX = portRect.left + portRect.width / 2 - rect.left;
    const portCenterY = portRect.top + portRect.height / 2 - rect.top;
    
    console.log('[WorkflowCanvas] Starting connection from port:', { 
      nodeId, 
      portType, 
      portId,
      x: portCenterX,
      y: portCenterY
    });
    
    setConnectingPort({
      nodeId,
      portType,
      portId,
      x: portCenterX,
      y: portCenterY,
    });
    setTempConnectionEnd({ x: portCenterX, y: portCenterY });
  }, []);

  // Handle connection mouse move
  const handleConnectionMouseMove = useCallback((e: React.MouseEvent) => {
    if (connectingPort && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setTempConnectionEnd({ x, y });
    }
  }, [connectingPort]);

  // Handle connection mouse up (complete connection)
  const handleConnectionMouseUp = useCallback((e: React.MouseEvent) => {
    if (!connectingPort) return;
    
    console.log('[WorkflowCanvas] Connection mouse up, checking target');
    
    // Find the target port element
    const targetElement = document.elementFromPoint(e.clientX, e.clientY);
    const portElement = targetElement?.closest('[data-port-type]') as HTMLElement;
    
    if (portElement) {
      const targetNodeId = portElement.getAttribute('data-node-id');
      const targetPortType = portElement.getAttribute('data-port-type') as 'input' | 'output';
      const targetPortId = portElement.getAttribute('data-port-id');
      
      console.log('[WorkflowCanvas] Found target port:', { 
        targetNodeId, 
        targetPortType, 
        targetPortId 
      });
      
      // Validate connection: output -> input only
      if (
        targetNodeId && 
        targetPortType && 
        targetPortId &&
        targetNodeId !== connectingPort.nodeId &&
        connectingPort.portType === 'output' && 
        targetPortType === 'input'
      ) {
        // Check if connection already exists
        const existingConnection = connections.find(
          conn => 
            conn.source === connectingPort.nodeId && 
            conn.target === targetNodeId &&
            conn.sourceHandle === connectingPort.portId &&
            conn.targetHandle === targetPortId
        );
        
        if (!existingConnection) {
          const newConnection: WorkflowConnection = {
            id: `conn-${Date.now()}`,
            source: connectingPort.nodeId,
            target: targetNodeId,
            sourceHandle: connectingPort.portId,
            targetHandle: targetPortId,
          };
          
          console.log('[WorkflowCanvas] Creating new connection:', newConnection);
          onConnectionsChange([...connections, newConnection]);
        } else {
          console.log('[WorkflowCanvas] Connection already exists, skipping');
        }
      } else {
        console.log('[WorkflowCanvas] Invalid connection attempt:', {
          reason: connectingPort.portType === 'input' 
            ? 'Cannot connect from input port' 
            : targetPortType === 'output' 
              ? 'Cannot connect to output port'
              : 'Same node or invalid target'
        });
      }
    } else {
      console.log('[WorkflowCanvas] No valid target port found');
    }
    
    // Reset connection state
    setConnectingPort(null);
    setTempConnectionEnd(null);
  }, [connectingPort, connections, onConnectionsChange]);

  // Handle node deletion
  const handleDeleteNode = useCallback((nodeId: string) => {
    console.log('[WorkflowCanvas] Deleting node:', { nodeId });
    
    // Remove node
    const updatedNodes = nodes.filter(node => node.id !== nodeId);
    
    // Remove connections associated with the node
    const updatedConnections = connections.filter(
      conn => conn.source !== nodeId && conn.target !== nodeId
    );
    
    console.log('[WorkflowCanvas] Node deletion - updated counts:', {
      nodeId,
      previousNodesCount: nodes.length,
      updatedNodesCount: updatedNodes.length,
      previousConnectionsCount: connections.length,
      updatedConnectionsCount: updatedConnections.length
    });
    
    // Use combined update to avoid stale closure issues
    if (onNodesAndConnectionsChange) {
      console.log('[WorkflowCanvas] Using combined update for nodes and connections');
      onNodesAndConnectionsChange(updatedNodes, updatedConnections);
    } else {
      console.log('[WorkflowCanvas] Using separate updates for nodes and connections (fallback)');
      onNodesChange(updatedNodes);
      onConnectionsChange(updatedConnections);
    }
    
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  }, [nodes, connections, selectedNodeId, onNodesChange, onConnectionsChange, onNodesAndConnectionsChange]);

  // Handle canvas pan start
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    // Only handle canvas panning in pan mode and when not clicking on nodes
    if (isPanMode && !e.defaultPrevented && e.button === 0) {
      console.log('[WorkflowCanvas] Canvas pan started:', {
        mouseX: e.clientX,
        mouseY: e.clientY,
        currentOffset: canvasOffset,
        timestamp: new Date().toISOString()
      });
      
      setIsDraggingCanvas(true);
      setCanvasDragStart({
        x: e.clientX,
        y: e.clientY,
        offsetX: canvasOffset.x,
        offsetY: canvasOffset.y,
      });
    }
  }, [isPanMode, canvasOffset]);

  // Handle node drag start
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    // Don't drag nodes in pan mode
    if (isPanMode) {
      return;
    }
    
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const offsetX = e.clientX - rect.left - (node.position.x + canvasOffset.x) * scale;
        const offsetY = e.clientY - rect.top - (node.position.y + canvasOffset.y) * scale;
        
        console.log('[WorkflowCanvas] Node drag started:', { 
          nodeId, 
          offsetX, 
          offsetY,
          initialPosition: node.position
        });
        
        // 初始化拖动位置为当前位置
        dragPositionRef.current[nodeId] = { x: node.position.x, y: node.position.y };
        isDraggingRef.current = true;
        hasMovedRef.current = false; // 重置移动标记
        
        // 设置拖动状态，但不立即修改 transform
        // 只有在真正开始移动时才设置内联样式
        setDraggingNode({ id: nodeId, offsetX, offsetY });
        handleNodeClick(nodeId);
      }
    }
  }, [nodes, handleNodeClick, scale, canvasOffset, isPanMode]);

  // Handle node dragging (优化版本 - 使用 requestAnimationFrame)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Handle connection drawing
    if (connectingPort) {
      handleConnectionMouseMove(e);
      return;
    }
    
    // Handle canvas panning
    if (isDraggingCanvas && canvasDragStart) {
      const deltaX = (e.clientX - canvasDragStart.x) / scale;
      const deltaY = (e.clientY - canvasDragStart.y) / scale;
      
      setCanvasOffset({
        x: canvasDragStart.offsetX + deltaX,
        y: canvasDragStart.offsetY + deltaY,
      });
      
      // Force re-render connections during canvas pan
      setConnectionRenderKey(prev => prev + 1);
      return;
    }
    
    if (draggingNode && isDraggingRef.current) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        
        // 标记已经发生了移动
        if (!hasMovedRef.current) {
          hasMovedRef.current = true;
          console.log('[WorkflowCanvas] Node movement started:', { nodeId: draggingNode.id });
        }
        
        // 存储鼠标位置，用于 RAF 回调
        lastMousePositionRef.current = { x: mouseX, y: mouseY };
        
        // 使用 requestAnimationFrame 优化渲染，避免频繁计算和DOM更新
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            if (lastMousePositionRef.current && canvasRef.current) {
              const rect = canvasRef.current.getBoundingClientRect();
              const x = (lastMousePositionRef.current.x - rect.left - draggingNode.offsetX) / scale - canvasOffset.x;
              const y = (lastMousePositionRef.current.y - rect.top - draggingNode.offsetY) / scale - canvasOffset.y;
              
              // 更新临时位置
              dragPositionRef.current[draggingNode.id] = { x, y };
              
              // Force re-render to update node position and connections
              // 直接更新状态触发重新渲染，而不是操作DOM
              setConnectionRenderKey(prev => prev + 1);
              
              // 重置 RAF 引用，允许下一次更新
              rafRef.current = null;
            }
          });
        }
      }
    }
  }, [draggingNode, scale, canvasOffset, connectingPort, handleConnectionMouseMove, isDraggingCanvas, canvasDragStart]);

  // Handle node drag end
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Handle connection completion
    if (connectingPort) {
      handleConnectionMouseUp(e);
      return;
    }
    
    // Handle canvas pan end
    if (isDraggingCanvas && canvasDragStart) {
      console.log('[WorkflowCanvas] Canvas pan ended:', {
        newOffset: canvasOffset,
        timestamp: new Date().toISOString()
      });
      
      setIsDraggingCanvas(false);
      setCanvasDragStart(null);
      return;
    }
    
    if (draggingNode && isDraggingRef.current) {
      const hasMoved = hasMovedRef.current;
      console.log('[WorkflowCanvas] Node drag ended:', { 
        nodeId: draggingNode.id, 
        hasMoved 
      });
      
      // 取消待处理的动画帧
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      
      // 只有在真正移动过时才更新位置
      if (hasMoved) {
        const finalPosition = dragPositionRef.current[draggingNode.id];
        if (finalPosition) {
          console.log('[WorkflowCanvas] Node drag completed, updating position:', {
            nodeId: draggingNode.id,
            finalPosition
          });
          
          const updatedNodes = nodes.map(node => 
            node.id === draggingNode.id
              ? { ...node, position: finalPosition }
              : node
          );
          
          onNodesChange(updatedNodes);
          
          // 清理临时位置 - 让 React 使用更新后的 node.position 重新渲染
          delete dragPositionRef.current[draggingNode.id];
          
          // Force re-render connections after node position update
          console.log('[WorkflowCanvas] Forcing connection re-render after node move');
          setConnectionRenderKey(prev => prev + 1);
        }
      } else {
        // 如果没有移动（单击），不做任何位置更新，只清理临时数据
        console.log('[WorkflowCanvas] Click detected (no movement), skipping position update');
        delete dragPositionRef.current[draggingNode.id];
      }
      
      // 清理状态
      lastMousePositionRef.current = null;
      isDraggingRef.current = false;
      hasMovedRef.current = false;
      setDraggingNode(null);
    }
  }, [draggingNode, nodes, onNodesChange, connectingPort, handleConnectionMouseUp, isDraggingCanvas, canvasDragStart, canvasOffset]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete selected node with Delete key only (Backspace disabled to prevent accidental deletion)
      if (e.key === 'Delete' && selectedNodeId) {
        e.preventDefault();
        console.log('[WorkflowCanvas] Deleting node via keyboard (Delete key):', { nodeId: selectedNodeId });
        handleDeleteNode(selectedNodeId);
      }
      
      // Delete selected connection with Delete key only (Backspace disabled to prevent accidental deletion)
      if (e.key === 'Delete' && selectedConnectionId) {
        e.preventDefault();
        console.log('[WorkflowCanvas] Deleting connection via keyboard (Delete key):', { connectionId: selectedConnectionId });
        handleDeleteConnection(selectedConnectionId);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, selectedConnectionId, handleDeleteNode, handleDeleteConnection]);

  // 清理函数：组件卸载时取消动画帧
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Toggle pan mode
  const handleTogglePanMode = useCallback(() => {
    const newPanMode = !isPanMode;
    console.log('[WorkflowCanvas] Toggling pan mode:', {
      previousMode: isPanMode ? 'pan' : 'node-drag',
      newMode: newPanMode ? 'pan' : 'node-drag',
      timestamp: new Date().toISOString()
    });
    
    setIsPanMode(newPanMode);
    
    // Clear any active dragging states when switching modes
    if (isDraggingCanvas) {
      setIsDraggingCanvas(false);
      setCanvasDragStart(null);
    }
    if (draggingNode) {
      setDraggingNode(null);
      isDraggingRef.current = false;
      hasMovedRef.current = false;
    }
  }, [isPanMode, isDraggingCanvas, draggingNode]);

  return (
    <div className="h-full w-full bg-muted relative overflow-hidden select-none">
      {/* Canvas */}
      <div
        ref={canvasRef}
        className="h-full w-full relative select-none"
        onContextMenu={handleContextMenu}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseDown={handleCanvasMouseDown}
        onClick={() => {
          console.log('[WorkflowCanvas] Canvas clicked, deselecting node and connection');
          setSelectedNodeId(null);
          setSelectedConnectionId(null);
        }}
        style={{ 
          userSelect: 'none', 
          WebkitUserSelect: 'none',
          cursor: isPanMode 
            ? (isDraggingCanvas ? 'grabbing' : 'grab')
            : 'default'
        }}
      >
        {/* Grid Background */}
        <div 
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, var(--border) 1px, transparent 1px),
              linear-gradient(to bottom, var(--border) 1px, transparent 1px)
            `,
            backgroundSize: `${20 * scale}px ${20 * scale}px`,
            backgroundPosition: `${canvasOffset.x * scale}px ${canvasOffset.y * scale}px`
          }}
        />

        {/* Connections SVG Layer */}
        <svg 
          className="absolute inset-0 pointer-events-none" 
          style={{ width: '100%', height: '100%', zIndex: 1 }}
          key={`connections-${connectionRenderKey}`}
        >
          {/* Render existing connections */}
          {connections.map((connection) => {
            const sourcePos = getPortPosition(connection.source, connection.sourceHandle || 'output-1', 'output');
            const targetPos = getPortPosition(connection.target, connection.targetHandle || 'input-1', 'input');
            
            if (sourcePos && targetPos) {
              const path = createConnectionPath(sourcePos.x, sourcePos.y, targetPos.x, targetPos.y);
              const isSelected = selectedConnectionId === connection.id;
              
              // Calculate midpoint for delete button
              const midX = (sourcePos.x + targetPos.x) / 2;
              const midY = (sourcePos.y + targetPos.y) / 2;
              
              return (
                <g key={connection.id}>
                  {/* Visible connection line */}
                  <path
                    d={path}
                    stroke={isSelected ? "var(--destructive)" : "var(--primary)"}
                    strokeWidth={isSelected ? "3" : "2"}
                    fill="none"
                    strokeLinecap="round"
                  />
                  {/* Invisible wider path for easier clicking */}
                  <path
                    d={path}
                    stroke="transparent"
                    strokeWidth="10"
                    fill="none"
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => handleConnectionClick(connection.id, e)}
                  />
                  
                  {/* Delete button (shown when selected) */}
                  {isSelected && (
                    <g>
                      {/* Button background circle */}
                      <circle
                        cx={midX}
                        cy={midY}
                        r="12"
                        fill="var(--card)"
                        stroke="var(--destructive)"
                        strokeWidth="2"
                        className="pointer-events-auto cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteConnection(connection.id);
                        }}
                      />
                      {/* X icon */}
                      <g
                        className="pointer-events-auto cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteConnection(connection.id);
                        }}
                      >
                        <line
                          x1={midX - 5}
                          y1={midY - 5}
                          x2={midX + 5}
                          y2={midY + 5}
                          stroke="var(--destructive)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <line
                          x1={midX + 5}
                          y1={midY - 5}
                          x2={midX - 5}
                          y2={midY + 5}
                          stroke="var(--destructive)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </g>
                    </g>
                  )}
                </g>
              );
            }
            return null;
          })}
          
          {/* Render temporary connection while dragging */}
          {connectingPort && tempConnectionEnd && (
            <path
              d={createConnectionPath(
                connectingPort.x,
                connectingPort.y,
                tempConnectionEnd.x,
                tempConnectionEnd.y
              )}
              stroke="var(--muted-foreground)"
              strokeWidth="2"
              fill="none"
              strokeDasharray="5,5"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Nodes */}
        {nodes.map(node => {
          // 如果正在拖动，使用临时位置；否则使用实际位置
          const position = draggingNode?.id === node.id && dragPositionRef.current[node.id]
            ? dragPositionRef.current[node.id]
            : node.position;
          
          const isDragging = draggingNode?.id === node.id;
          const translateX = (position.x + canvasOffset.x) * scale;
          const translateY = (position.y + canvasOffset.y) * scale;
          
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              className="absolute"
              style={{
                // 使用 transform 代替 left/top 以启用硬件加速
                left: 0,
                top: 0,
                zIndex: 10,
                // 始终设置 transform，拖动时会被 handleMouseMove 覆盖
                transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
                transformOrigin: 'top left',
                cursor: isPanMode 
                  ? 'grab' 
                  : (isDragging ? 'grabbing' : 'grab'),
                willChange: isDragging ? 'transform' : 'auto',
                transition: isDragging ? 'none' : 'transform 0.1s ease',
                // 启用硬件加速
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                pointerEvents: isPanMode ? 'none' : 'auto',
              }}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onClick={(e) => {
                e.stopPropagation();
                handleNodeClick(node.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                handleNodeDoubleClick(node.id);
              }}
            >
              {node.type === 'start' && (
                <StartNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'end' && (
                <EndNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'chat-llm' && (
                <ChatLLMNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'text-input' && (
                <TextInputNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'pexels-video-search' && (
                <PexelsVideoSearchNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'tavily-search' && (
                <TavilySearchNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'volcano-tts' && (
                <VolcanoTTSNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'to-array' && (
                <ToArrayNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'results-combine' && (
                <ResultsCombineNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'ai-video-generate' && (
                <AIVideoGenerateNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
              {node.type === 'video-export' && (
                <VideoExportNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                  onPortMouseDown={handlePortMouseDown}
                  executionStatus={nodeExecutionStates[node.id]?.status}
                />
              )}
            </div>
          );
        })}

        {/* Context Menu */}
        {contextMenu.visible && (
          <div
            className="absolute bg-card rounded-md shadow-lg border border-border py-2 z-50 min-w-[180px]"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleAddStartNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-foreground">Add Start Node</span>
            </button>
            
            <button
              onClick={handleAddEndNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              <span className="text-sm text-foreground">Add End Node</span>
            </button>
            
            <div className="h-px bg-border my-1" />
            
            <button
              onClick={handleAddChatLLMNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-sm text-foreground">Add Chat LLM</span>
            </button>
            
            <button
              onClick={handleAddTextInputNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="text-sm text-foreground">Add Text Input</span>
            </button>
            
            <div className="h-px bg-border my-1" />
            
            <button
              onClick={handleAddPexelsVideoSearchNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-sm text-foreground">Add Pexels Video Search</span>
            </button>
            
            <button
              onClick={handleAddTavilySearchNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-sm text-foreground">Add Tavily Search</span>
            </button>
            
            <div className="h-px bg-border my-1" />
            
            <button
              onClick={handleAddVolcanoTTSNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-sm text-foreground">Add Volcano TTS</span>
            </button>
            
            <div className="h-px bg-border my-1" />
            
            <button
              onClick={handleAddToArrayNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <span className="text-sm text-foreground">Add To Array</span>
            </button>
            
            <button
              onClick={handleAddResultsCombineNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span className="text-sm text-foreground">Add Results Combine</span>
            </button>
            
            <div className="h-px bg-border my-1" />
            
            <button
              onClick={handleAddAIVideoGenerateNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm text-foreground">Add AI Video Generate</span>
            </button>
            
            <button
              onClick={handleAddVideoExportNode}
              className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span className="text-sm text-foreground">Add Video Export</span>
            </button>
          </div>
        )}

        {/* Instructions Overlay (when no nodes) */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-card rounded-md p-8 max-w-md text-center">
              <div className="w-16 h-16 bg-secondary rounded-md mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Start Building Your Workflow
              </h3>
              <p className="text-sm text-muted-foreground">
                Right-click anywhere on the canvas to add your first node
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="absolute top-4 right-4 bg-card rounded-md border border-border p-2 flex items-center space-x-2">
        <button
          onClick={() => {
            const newScale = Math.max(0.5, scale - 0.1);
            console.log('[WorkflowCanvas] Zoom out:', { newScale });
            setScale(newScale);
          }}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="Zoom Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
          </svg>
        </button>
        
        <span className="text-xs text-muted-foreground min-w-[50px] text-center">
          {Math.round(scale * 100)}%
        </span>
        
        <button
          onClick={() => {
            const newScale = Math.min(2, scale + 0.1);
            console.log('[WorkflowCanvas] Zoom in:', { newScale });
            setScale(newScale);
          }}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="Zoom In"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>

        <div className="w-px h-6 bg-border mx-1" />

        <button
          onClick={handleTogglePanMode}
          className={`p-2 rounded transition-colors ${
            isPanMode
              ? 'bg-primary/15 text-primary hover:bg-primary/25'
              : 'hover:bg-accent text-foreground'
          }`}
          title={isPanMode ? "Exit Pan Mode (Switch to Node Drag Mode)" : "Enter Pan Mode (Drag Canvas)"}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
          </svg>
        </button>

        <div className="w-px h-6 bg-border mx-1" />

        <button
          onClick={() => {
            console.log('[WorkflowCanvas] Reset zoom and position');
            setScale(1);
            setCanvasOffset({ x: 0, y: 0 });
          }}
          className="p-2 hover:bg-accent rounded transition-colors"
          title="Reset View"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Info Bar */}
      <div className="absolute bottom-4 left-4 bg-card rounded-md border border-border px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center space-x-4">
          <span>Nodes: {nodes.length}</span>
          <span>•</span>
          <span>Connections: {connections.length}</span>
          {selectedNodeId && (
            <>
              <span>•</span>
              <span className="text-primary font-medium">Node Selected</span>
            </>
          )}
          {selectedConnectionId && (
            <>
              <span>•</span>
              <span className="text-red-600 font-medium">Connection Selected</span>
            </>
          )}
        </div>
      </div>

      {/* Config Panels */}
      {configPanelNodeId && (() => {
        const node = nodes.find(n => n.id === configPanelNodeId);
        if (!node) return null;
        
        // Chat LLM Config Panel
        if (node.type === 'chat-llm') {
          return (
            <ChatLLMConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as ChatLLMNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // Text Input Config Panel
        if (node.type === 'text-input') {
          return (
            <TextInputConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as TextInputNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // Start Node Config Panel
        if (node.type === 'start') {
          return (
            <StartNodeConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as StartNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // Pexels Video Search Config Panel
        if (node.type === 'pexels-video-search') {
          return (
            <PexelsVideoSearchConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as PexelsVideoSearchNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // Tavily Search Config Panel
        if (node.type === 'tavily-search') {
          return (
            <TavilySearchConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as TavilySearchNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // Volcano TTS Config Panel
        if (node.type === 'volcano-tts') {
          return (
            <VolcanoTTSConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as VolcanoTTSNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // To Array Config Panel
        if (node.type === 'to-array') {
          return (
            <ToArrayConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as ToArrayNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // Results Combine Config Panel
        if (node.type === 'results-combine') {
          return (
            <ResultsCombineConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as ResultsCombineNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // AI Video Generate Config Panel
        if (node.type === 'ai-video-generate') {
          return (
            <AIVideoGenerateConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as AIVideoGenerateNodeConfig) || {}}
              onSave={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        // Video Export Config Panel
        if (node.type === 'video-export') {
          return (
            <VideoExportConfigPanel
              nodeId={configPanelNodeId}
              config={(node.data.config as VideoExportNodeConfig) || {}}
              onConfigChange={handleConfigSave}
              onClose={handleConfigPanelClose}
            />
          );
        }
        
        return null;
      })()}
    </div>
  );
};

export default WorkflowCanvas;

