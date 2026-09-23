'use client';

import React from 'react';
import { useSegmentCommandsValue } from '../lib/segments/SegmentLinksContext';
import VoiceDurationDialog from '../components/SegmentDialogs/VoiceDurationDialog';
import SegmentImpactDialog from '../components/SegmentDialogs/SegmentImpactDialog';
import SegmentDeleteDialog from '../components/SegmentDialogs/SegmentDeleteDialog';

/**
 * The one place the segment command dialogs render (spec R2 §5.1): the
 * dialog state lives in `useSegmentCommands`, this host only draws it.
 */
const SegmentDialogsHost: React.FC = () => {
  const commands = useSegmentCommandsValue();
  if (!commands) return null;
  const { dialog, closeDialog } = commands;
  switch (dialog.kind) {
    case 'voice-duration':
      return (
        <VoiceDurationDialog
          delta={dialog.delta}
          lines={dialog.lines}
          canKeep={dialog.canKeep}
          isStaleVersion={dialog.isStaleVersion}
          onChoose={commands.chooseVoiceDuration}
          onClose={closeDialog}
        />
      );
    case 'impact':
      return (
        <SegmentImpactDialog
          title={dialog.title}
          message={dialog.message}
          lines={dialog.lines}
          confirmLabel={dialog.confirmLabel}
          onConfirm={dialog.onConfirm}
          onClose={closeDialog}
        />
      );
    case 'delete':
      return (
        <SegmentDeleteDialog
          key={dialog.segmentId}
          ordinal={dialog.ordinal}
          title={dialog.title}
          removedItems={dialog.removedItems}
          removalLines={dialog.removalLines}
          isEditLocked={dialog.isEditLocked}
          onConfirm={(removeTimelineItems) => commands.remove(dialog.segmentId, { removeTimelineItems })}
          onClose={closeDialog}
        />
      );
    default:
      return null;
  }
};

export default SegmentDialogsHost;
