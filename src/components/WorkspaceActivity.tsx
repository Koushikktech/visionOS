'use client';

import { createContext, useContext } from 'react';

/** Transient UI activity only. Never changes saved artwork or runtime permission grants. */
export const WorkspaceActivity = createContext(true);
export function useWorkspaceActive() { return useContext(WorkspaceActivity); }
