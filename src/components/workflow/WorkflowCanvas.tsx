'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { WorkflowNode, WorkflowConnection, WorkflowNodePosition } from '@/types';
import ChatLLMNode from './nodes/ChatLLMNode';

interface WorkflowCanvasProps {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  onNodesChange: (nodes: WorkflowNode[]) => void;
  onConnectionsChange: (connections: WorkflowConnection[]) => void;
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
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [canvasOffset, setCanvasOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  
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
    scale,
    timestamp: new Date().toISOString()
  });

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

  // Handle node deletion
  const handleDeleteNode = useCallback((nodeId: string) => {
    console.log('[WorkflowCanvas] Deleting node:', { nodeId });
    
    // Remove node
    const updatedNodes = nodes.filter(node => node.id !== nodeId);
    
    // Remove connections associated with the node
    const updatedConnections = connections.filter(
      conn => conn.source !== nodeId && conn.target !== nodeId
    );
    
    onNodesChange(updatedNodes);
    onConnectionsChange(updatedConnections);
    
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  }, [nodes, connections, selectedNodeId, onNodesChange, onConnectionsChange]);

  // Handle node drag start
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
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
  }, [nodes, handleNodeClick, scale, canvasOffset]);

  // Handle node dragging (优化版本 - 使用 requestAnimationFrame)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
              
              // 直接更新DOM，使用 transform 代替 left/top 以获得更好的性能（硬件加速）
              const nodeElement = document.querySelector(`[data-node-id="${draggingNode.id}"]`) as HTMLElement;
              if (nodeElement) {
                // 使用 transform 进行硬件加速的移动
                const translateX = (x + canvasOffset.x) * scale;
                const translateY = (y + canvasOffset.y) * scale;
                nodeElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
              }
              
              // 重置 RAF 引用，允许下一次更新
              rafRef.current = null;
            }
          });
        }
      }
    }
  }, [draggingNode, scale, canvasOffset]);

  // Handle node drag end
  const handleMouseUp = useCallback(() => {
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
          const updatedNodes = nodes.map(node => 
            node.id === draggingNode.id
              ? { ...node, position: finalPosition }
              : node
          );
          
          onNodesChange(updatedNodes);
          
          // 清理节点的内联 transform 样式，让 React 接管渲染
          const nodeElement = document.querySelector(`[data-node-id="${draggingNode.id}"]`) as HTMLElement;
          if (nodeElement) {
            nodeElement.style.transform = '';
          }
          
          // 清理临时位置
          delete dragPositionRef.current[draggingNode.id];
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
  }, [draggingNode, nodes, onNodesChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete selected node with Delete or Backspace key
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        console.log('[WorkflowCanvas] Deleting node via keyboard:', { nodeId: selectedNodeId });
        handleDeleteNode(selectedNodeId);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, handleDeleteNode]);

  // 清理函数：组件卸载时取消动画帧
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div className="h-full w-full bg-gray-50 relative overflow-hidden">
      {/* Canvas */}
      <div
        ref={canvasRef}
        className="h-full w-full relative cursor-default"
        onContextMenu={handleContextMenu}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={() => {
          console.log('[WorkflowCanvas] Canvas clicked, deselecting node');
          setSelectedNodeId(null);
        }}
      >
        {/* Grid Background */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(to right, #e5e7eb 1px, transparent 1px),
              linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)
            `,
            backgroundSize: `${20 * scale}px ${20 * scale}px`,
            backgroundPosition: `${canvasOffset.x * scale}px ${canvasOffset.y * scale}px`
          }}
        />

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
                // 始终设置 transform，拖动时会被 handleMouseMove 覆盖
                transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
                transformOrigin: 'top left',
                cursor: isDragging ? 'grabbing' : 'grab',
                willChange: isDragging ? 'transform' : 'auto',
                transition: isDragging ? 'none' : 'transform 0.1s ease',
                // 启用硬件加速
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
              }}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onClick={(e) => {
                e.stopPropagation();
                handleNodeClick(node.id);
              }}
            >
              {node.type === 'chat-llm' && (
                <ChatLLMNode
                  id={node.id}
                  data={node.data}
                  selected={selectedNodeId === node.id}
                  onDelete={() => handleDeleteNode(node.id)}
                />
              )}
            </div>
          );
        })}

        {/* Context Menu */}
        {contextMenu.visible && (
          <div
            className="absolute bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50 min-w-[180px]"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleAddChatLLMNode}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center space-x-3 transition-colors"
            >
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-sm text-gray-700">Add Chat LLM</span>
            </button>
          </div>
        )}

        {/* Instructions Overlay (when no nodes) */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-8 max-w-md text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Start Building Your Workflow
              </h3>
              <p className="text-sm text-gray-600">
                Right-click anywhere on the canvas to add your first node
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex items-center space-x-2">
        <button
          onClick={() => {
            const newScale = Math.max(0.5, scale - 0.1);
            console.log('[WorkflowCanvas] Zoom out:', { newScale });
            setScale(newScale);
          }}
          className="p-2 hover:bg-gray-100 rounded transition-colors"
          title="Zoom Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
          </svg>
        </button>
        
        <span className="text-xs text-gray-600 min-w-[50px] text-center">
          {Math.round(scale * 100)}%
        </span>
        
        <button
          onClick={() => {
            const newScale = Math.min(2, scale + 0.1);
            console.log('[WorkflowCanvas] Zoom in:', { newScale });
            setScale(newScale);
          }}
          className="p-2 hover:bg-gray-100 rounded transition-colors"
          title="Zoom In"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        <button
          onClick={() => {
            console.log('[WorkflowCanvas] Reset zoom and position');
            setScale(1);
            setCanvasOffset({ x: 0, y: 0 });
          }}
          className="p-2 hover:bg-gray-100 rounded transition-colors"
          title="Reset View"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Info Bar */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 px-4 py-2 text-xs text-gray-600">
        <div className="flex items-center space-x-4">
          <span>Nodes: {nodes.length}</span>
          <span>•</span>
          <span>Connections: {connections.length}</span>
          {selectedNodeId && (
            <>
              <span>•</span>
              <span className="text-blue-600 font-medium">Node Selected</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowCanvas;

