# Workflow Canvas Pan Mode API Documentation

## Overview

The Workflow Canvas Pan Mode feature allows users to toggle between two interaction modes:
1. **Node Drag Mode** (Default): Drag and reposition individual workflow nodes
2. **Pan Mode**: Drag the entire canvas to navigate around the workflow

This feature enhances the user experience when working with large workflows that extend beyond the visible viewport.

## Features

### 1. Mode Toggle Button
- Hand icon button in the top-right toolbar
- Visual feedback for active/inactive states
- Smooth transitions between modes

### 2. Pan Mode Interaction
- Click and drag anywhere on the canvas to pan
- Nodes become non-interactive during pan mode
- Canvas cursor changes to indicate pan capability

### 3. Mode Switching
- Single click toggles between modes
- Automatic cleanup of active drag states when switching
- Preserves canvas position and zoom level

## Component Architecture

### WorkflowCanvas

**Location**: `src/components/workflow/WorkflowCanvas.tsx`

**New State Variables**:
```typescript
const [isPanMode, setIsPanMode] = useState(false);
const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
const [canvasDragStart, setCanvasDragStart] = useState<{
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
} | null>(null);
```

**State Management**:
- `isPanMode`: Boolean flag indicating whether pan mode is active
- `isDraggingCanvas`: Boolean flag indicating whether the canvas is being dragged
- `canvasDragStart`: Stores the initial drag position and canvas offset

## User Interface

### Toolbar Button

**Location**: Top-right toolbar, between zoom controls and reset button

**Visual States**:
- **Inactive** (Node Drag Mode):
  - Gray background with hover effect
  - Dark gray icon
  - Tooltip: "Enter Pan Mode (Drag Canvas)"

- **Active** (Pan Mode):
  - Blue background (`bg-blue-100`)
  - Blue icon (`text-blue-600`)
  - Tooltip: "Exit Pan Mode (Switch to Node Drag Mode)"

**Button Icon**:
- Hand/palm SVG icon representing drag/pan gesture
- Consistent size with other toolbar buttons (w-4 h-4)

### Cursor Changes

| Mode | State | Cursor |
|------|-------|--------|
| Node Drag Mode | Default | `default` |
| Node Drag Mode | Dragging Node | `grabbing` |
| Pan Mode | Default | `grab` |
| Pan Mode | Dragging Canvas | `grabbing` |

## Interaction Flow

### Entering Pan Mode

```
User Clicks Hand Button → isPanMode = true → Canvas cursor changes to 'grab'
```

**Detailed Steps**:
1. User clicks the hand icon button in toolbar
2. `handleTogglePanMode()` is called
3. `isPanMode` state is set to `true`
4. Canvas cursor changes to `grab`
5. Node `pointerEvents` are set to `none`
6. Console log: `[WorkflowCanvas] Toggling pan mode`

### Pan Mode Interaction

```
Mouse Down on Canvas → isDraggingCanvas = true → Mouse Move updates offset → Mouse Up ends drag
```

**Detailed Steps**:
1. User clicks and holds on canvas (not on a node)
2. `handleCanvasMouseDown()` is triggered
3. `isDraggingCanvas` is set to `true`
4. Initial mouse position and canvas offset are stored
5. As mouse moves, `handleMouseMove()` calculates new canvas offset
6. Canvas offset is updated in real-time
7. Connections are re-rendered to match new canvas position
8. On mouse up, `handleMouseUp()` finalizes the pan
9. Console logs track pan start and end

### Exiting Pan Mode

```
User Clicks Hand Button Again → isPanMode = false → Node Drag Mode restored
```

**Detailed Steps**:
1. User clicks the hand icon button again
2. `handleTogglePanMode()` is called
3. `isPanMode` state is set to `false`
4. Canvas cursor returns to `default`
5. Node `pointerEvents` are restored to `auto`
6. Any active drag states are cleared

## Technical Implementation

### Canvas Panning Logic

**Mouse Down Handler**:
```typescript
const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
  if (isPanMode && !e.defaultPrevented && e.button === 0) {
    setIsDraggingCanvas(true);
    setCanvasDragStart({
      x: e.clientX,
      y: e.clientY,
      offsetX: canvasOffset.x,
      offsetY: canvasOffset.y,
    });
  }
}, [isPanMode, canvasOffset]);
```

**Mouse Move Handler**:
```typescript
// In handleMouseMove
if (isDraggingCanvas && canvasDragStart) {
  const deltaX = (e.clientX - canvasDragStart.x) / scale;
  const deltaY = (e.clientY - canvasDragStart.y) / scale;
  
  setCanvasOffset({
    x: canvasDragStart.offsetX + deltaX,
    y: canvasDragStart.offsetY + deltaY,
  });
  
  setConnectionRenderKey(prev => prev + 1);
}
```

**Mouse Up Handler**:
```typescript
// In handleMouseUp
if (isDraggingCanvas && canvasDragStart) {
  setIsDraggingCanvas(false);
  setCanvasDragStart(null);
}
```

### Node Interaction Prevention

When in pan mode, nodes have `pointerEvents: 'none'` to prevent interaction:

```typescript
style={{
  // ... other styles
  pointerEvents: isPanMode ? 'none' : 'auto',
}}
```

Additionally, `handleNodeMouseDown` checks for pan mode:

```typescript
const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
  if (isPanMode) {
    return; // Don't drag nodes in pan mode
  }
  // ... node dragging logic
}, [isPanMode, /* other deps */]);
```

### State Cleanup on Mode Switch

```typescript
const handleTogglePanMode = useCallback(() => {
  const newPanMode = !isPanMode;
  setIsPanMode(newPanMode);
  
  // Clear any active dragging states
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
```

## Logging

All pan mode operations are logged to the console for debugging:

### Mode Toggle Logs
```javascript
console.log('[WorkflowCanvas] Toggling pan mode:', {
  previousMode: isPanMode ? 'pan' : 'node-drag',
  newMode: newPanMode ? 'pan' : 'node-drag',
  timestamp: new Date().toISOString()
});
```

### Canvas Pan Logs
```javascript
// Pan start
console.log('[WorkflowCanvas] Canvas pan started:', {
  mouseX: e.clientX,
  mouseY: e.clientY,
  currentOffset: canvasOffset,
  timestamp: new Date().toISOString()
});

// Pan end
console.log('[WorkflowCanvas] Canvas pan ended:', {
  newOffset: canvasOffset,
  timestamp: new Date().toISOString()
});
```

### Render Logs
```javascript
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
```

## Styling Guidelines

### Button States

**Inactive State**:
```css
className="p-2 hover:bg-gray-100 rounded transition-all text-gray-700"
```

**Active State**:
```css
className="p-2 rounded transition-all bg-blue-100 text-blue-600 hover:bg-blue-200"
```

### Canvas Cursor

**Implementation**:
```typescript
style={{ 
  cursor: isPanMode 
    ? (isDraggingCanvas ? 'grabbing' : 'grab')
    : 'default'
}}
```

### Transitions

All state changes use smooth CSS transitions:
```css
transition-all
```

## Keyboard Shortcuts

Currently, there are no keyboard shortcuts for toggling pan mode. This could be a future enhancement.

**Suggested Future Shortcut**: Space bar to temporarily enable pan mode (hold to pan, release to return to node drag mode)

## Performance Considerations

### Connection Re-rendering

The `connectionRenderKey` is incremented during canvas panning to force connection re-rendering:

```typescript
setConnectionRenderKey(prev => prev + 1);
```

This ensures that connection lines follow the canvas position accurately.

### Smooth Panning

The canvas offset is calculated using the scale factor to ensure smooth panning at any zoom level:

```typescript
const deltaX = (e.clientX - canvasDragStart.x) / scale;
const deltaY = (e.clientY - canvasDragStart.y) / scale;
```

## Error Handling

### Null Checks

All event handlers check for null values before proceeding:

```typescript
if (isPanMode && !e.defaultPrevented && e.button === 0) {
  // Only proceed if conditions are met
}
```

### Button Check

Canvas panning only responds to left mouse button (button === 0).

## Integration Points

### Canvas Offset

The pan mode directly manipulates the `canvasOffset` state, which is used throughout the component:
- Node positioning calculations
- Grid background positioning
- Connection path calculations

### Zoom Integration

Pan mode works seamlessly with zoom controls:
- Panning respects the current zoom level
- Zoom level affects pan sensitivity
- Both features can be used together

### Reset View

The "Reset View" button resets both zoom and pan:
```typescript
setScale(1);
setCanvasOffset({ x: 0, y: 0 });
```

## Browser Compatibility

- **Chrome/Edge**: Full support, smooth performance
- **Firefox**: Full support, smooth performance
- **Safari**: Full support, smooth performance
- **Mobile browsers**: Touch events not yet implemented (future enhancement)

## Accessibility

### Button Accessibility
- Clear tooltip text describing the function
- Visual feedback on hover and active states
- Keyboard accessible (can be activated with Enter/Space)

### Screen Reader Support
The button has a descriptive `title` attribute:
- Active: "Exit Pan Mode (Switch to Node Drag Mode)"
- Inactive: "Enter Pan Mode (Drag Canvas)"

## Testing Recommendations

### Basic Functionality
1. Click hand button to enter pan mode
2. Verify cursor changes to `grab`
3. Click and drag canvas to pan
4. Verify cursor changes to `grabbing` during drag
5. Verify nodes move with canvas
6. Verify connections follow nodes
7. Click hand button again to exit pan mode
8. Verify cursor returns to default

### Mode Switching
1. Start dragging a node
2. Switch to pan mode mid-drag
3. Verify node drag is cancelled cleanly
4. Start panning canvas
5. Switch to node drag mode mid-pan
6. Verify pan is cancelled cleanly

### Zoom Integration
1. Zoom in to 200%
2. Enter pan mode
3. Pan around canvas
4. Verify panning is smooth
5. Zoom out to 50%
6. Verify panning still works correctly

### Edge Cases
1. Rapidly toggle pan mode on/off
2. Right-click during pan mode (should open context menu)
3. Pan to extreme positions
4. Verify reset view works after panning

## Known Limitations

1. **Touch Support**: Pan mode currently only works with mouse input. Touch gestures for mobile devices are not yet implemented.
2. **Temporary Pan**: There is no "hold space to pan" feature like in some design tools.
3. **Pan Boundaries**: The canvas can be panned infinitely; there are no boundaries or constraints.

## Future Enhancements

### Planned Features
1. **Space Bar to Pan**: Hold space bar to temporarily enable pan mode
2. **Touch Gestures**: Two-finger drag on mobile/tablet devices
3. **Pan Boundaries**: Optional boundary constraints to prevent panning too far
4. **Pan Animation**: Smooth animation when programmatically panning to specific positions
5. **Minimap**: Overview map showing canvas position and viewport
6. **Zoom to Fit**: Automatically pan and zoom to show all nodes

### Implementation Priority
1. High: Space bar temporary pan mode
2. Medium: Touch gesture support
3. Low: Minimap and advanced features

## Related Documentation

- [Workflow Canvas](../../src/components/workflow/WorkflowCanvas.tsx)
- [Workflow Interface](./workflow-chat-interface.md)
- [Workflow API](./workflow-api.md)

## Code Examples

### Checking Current Mode
```typescript
if (isPanMode) {
  // Pan mode is active
  console.log('Currently in pan mode');
} else {
  // Node drag mode is active
  console.log('Currently in node drag mode');
}
```

### Programmatically Toggling Mode
```typescript
// Toggle pan mode
handleTogglePanMode();

// Or directly set the state
setIsPanMode(true);  // Enter pan mode
setIsPanMode(false); // Exit pan mode
```

### Programmatically Pan Canvas
```typescript
// Pan to a specific position
setCanvasOffset({ x: 100, y: 100 });

// Pan relative to current position
setCanvasOffset({
  x: canvasOffset.x + 50,
  y: canvasOffset.y + 50,
});
```

## Summary

The Workflow Canvas Pan Mode feature provides an intuitive way to navigate large workflows by allowing users to drag the entire canvas. The implementation is clean, performant, and integrates seamlessly with existing zoom and node manipulation features. The hand button in the toolbar provides clear visual feedback, and the mode switching is smooth with proper state cleanup.

