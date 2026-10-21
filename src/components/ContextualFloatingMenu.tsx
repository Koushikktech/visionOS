'use client';

import React from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { useSpatialWorker } from '../hooks/useSpatialWorker';
import type { useSpatialAI } from '../hooks/useSpatialAI';
import { ContextualFormattingPill } from './ContextualFormattingPill';

export interface ContextualFloatingMenuProps {
  editor: Editor | null;
  spatial: ReturnType<typeof useSpatialWorker>;
  ai?: ReturnType<typeof useSpatialAI>;
}

/**
 * ContextualFloatingMenu - backwards-compatible wrapper for ContextualFormattingPill
 */
export const ContextualFloatingMenu: React.FC<ContextualFloatingMenuProps> = (props) => {
  return <ContextualFormattingPill {...props} />;
};

export default ContextualFloatingMenu;
