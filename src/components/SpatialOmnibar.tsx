'use client';

import React from 'react';
import { SpatialAIOmnibar } from './SpatialAIOmnibar';
import type { useSpatialAI } from '../hooks/useSpatialAI';
import type { useSpatialWorker } from '../hooks/useSpatialWorker';

export interface SpatialOmnibarProps {
  ai: ReturnType<typeof useSpatialAI>;
  spatial?: ReturnType<typeof useSpatialWorker>;
}

export const SpatialOmnibar: React.FC<SpatialOmnibarProps> = ({ ai, spatial }) => {
  return <SpatialAIOmnibar ai={ai} spatial={spatial} />;
};

export default SpatialOmnibar;
