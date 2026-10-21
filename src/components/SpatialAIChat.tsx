'use client';

import React from 'react';
import { SpatialAIOmnibar } from './SpatialAIOmnibar';
import type { useSpatialAI } from '../hooks/useSpatialAI';

export interface SpatialAIChatProps {
  ai: ReturnType<typeof useSpatialAI>;
}

export const SpatialAIChat: React.FC<SpatialAIChatProps> = ({ ai }) => {
  return <SpatialAIOmnibar ai={ai} />;
};

export default SpatialAIChat;
