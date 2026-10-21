// Spatial Action Protocol (SAP), Autonomous Agent Harness & Spatial Substrate Interfaces

export type ModalityType =
  | 'SANDBOX_ARTIFACT'
  | 'SYNTHESIS'
  | 'MEDIA_SEARCH'
  | 'VECTOR_DRAW'
  | 'IN_PLACE_MUTATE';

export type CardArchetype =
  | 'idea'        // Quick spark / sticky note (warm amber / casual)
  | 'note'        // Structured obsidian/documentation (frosted glass / headers / lists)
  | 'research'    // Deep tech / math derivations / KaTeX / code blocks (slate glass)
  | 'comparison'  // Grid / Matrix comparison (wide layout)
  | 'prompt';     // Action prompt / command block

export type VectorGlyphType =
  | 'database'   // Cylinder storage glyph
  | 'cloud'      // Cloud infrastructure container
  | 'decision'   // Diamond logic node
  | 'service'    // Microservice hexagon
  | 'queue'      // Message buffer queue
  | 'custom';    // Custom SVG path

export type MediaType = 'youtube' | 'web' | 'audio';

export interface DocSection {
  id: string;
  title: string;
  content: string;
  badge?: string;
}

export type SpatialOperation =
  | 'speculative_skeleton'
  | 'create_card'
  | 'create_rich_card'
  | 'create_code_card'
  | 'stream_card_patch'
  | 'create_group'
  | 'spawn_artifact'
  | 'embed_media'
  | 'draw_vector'
  | 'create_document'
  | 'mutate_document'
  | 'mutate_artifact'
  | 'mutate_rich_card'
  | 'mutate_code_card'
  | 'mutate_media'
  | 'mutate_vector'
  | 'connect'
  | 'align'
  | 'dock_into'
  | 'repel_colliding'
  | 'mutate_text'
  | 'restyle_shape'
  | 'delete_shape'
  | 'focus_viewport'
  | 'move_shape'
  | 'resize_shape';

export interface SpeculativeSkeletonBounds {
  id: string;
  title: string;
  modality?: ModalityType;
  x: number;
  y: number;
  w: number;
  h: number;
  statusText?: string;
}

export interface SpatialActionFrame {
  t: 'patch';
  op: SpatialOperation;
  id?: string;
  target?: string;
  anchor?: string;
  group?: string;
  from?: string;
  to?: string;
  title?: string;
  label?: string;
  slot?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  direction?: 'horizontal' | 'vertical' | 'grid';
  relative?: string;
  margin?: number;
  text?: string;
  content?: string;
  archetype?: CardArchetype;
  tags?: string[];
  code?: string; // HTML5 / JavaScript / Canvas simulation or source code
  language?: string; // Programming language (python, typescript, rust, go, sql, bash, etc.)
  description?: string;
  storage?: Record<string, string>; // Virtual persistent storage key-values
  initialStorage?: Record<string, string>; // Initial seed data for virtual storage
  mediaUrl?: string;
  mediaType?: MediaType;
  vectorType?: VectorGlyphType;
  svgPath?: string;
  color?: string;
  shapeType?: 'geo' | 'note' | 'artifact' | 'rich_card' | 'code_card' | 'media_embed' | 'vector_shape' | 'document' | 'frame';
  subtitle?: string;
  author?: string;
  date?: string;
  sections?: DocSection[];
  nodeIds?: string[];
  bend?: number;
  w?: number;
  h?: number;
  x?: number;
  y?: number;
  fill?: string;
  bounds?: { x: number; y: number; w: number; h: number };
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpatialNodeItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
  type: string;
  parentId?: string;
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  text?: string;
  content?: string;
  code?: string;
  language?: string;
  description?: string;
  storage?: Record<string, string>;
  archetype?: CardArchetype;
  sections?: DocSection[];
  mediaUrl?: string;
  mediaType?: MediaType;
  vectorType?: VectorGlyphType;
  svgPath?: string;
  color?: string;
  from?: string;
  to?: string;
  label?: string;
  zIndex?: number;
  rotation?: number;
  metadata?: Record<string, unknown>;
}

export interface SolvedNodeCoordinate {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface SolvedCreatedCard {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  text?: string;
  color?: string;
  shapeType?: 'geo' | 'note' | 'artifact' | 'rich_card' | 'code_card' | 'media_embed' | 'vector_shape';
}

export interface SolvedRichCardItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  content: string;
  archetype: CardArchetype;
  color?: string;
  tags?: string[];
  isStreaming?: boolean;
}

export interface SolvedCodeCardItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  language: string;
  code: string;
  description?: string;
  color?: string;
  isStreaming?: boolean;
}

export interface SolvedArtifactItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  code: string;
  color?: string;
  storage?: Record<string, string>;
}

export interface SolvedMediaEmbedItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  url: string;
  mediaType: MediaType;
  color?: string;
}

export interface SolvedVectorItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  vectorType: VectorGlyphType;
  svgPath?: string;
  label?: string;
  color?: string;
}

export interface SolvedConnectorItem {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  bend?: number;
  color?: string;
}

export interface SolvedGroupItem {
  id: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  nodeIds?: string[];
}

export interface SolvedTextMutation {
  id: string;
  text: string;
  color?: string;
}

export interface SolvedRestyle {
  id: string;
  color?: string;
  fill?: string;
}

export interface SolvedDocItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  sections: DocSection[];
}

export interface SolvedActionPayload {
  op: SpatialOperation;
  nodes?: SolvedNodeCoordinate[];
  createdCard?: SolvedCreatedCard;
  richCard?: SolvedRichCardItem;
  codeCard?: SolvedCodeCardItem;
  artifact?: SolvedArtifactItem;
  mediaEmbed?: SolvedMediaEmbedItem;
  vector?: SolvedVectorItem;
  document?: SolvedDocItem;
  connector?: SolvedConnectorItem;
  group?: SolvedGroupItem;
  textMutation?: SolvedTextMutation;
  restyle?: SolvedRestyle;
  skeleton?: SpeculativeSkeletonBounds;
  deletedIds?: string[];
  focusIds?: string[];
  executionTimeMs: number;
  actionSummary: string;
  rawFrame: SpatialActionFrame;
}

export interface SolvedLayoutResult {
  actions?: SolvedActionPayload[];
  nodes: SolvedNodeCoordinate[];
  createdCards?: SolvedCreatedCard[];
  richCards?: SolvedRichCardItem[];
  codeCards?: SolvedCodeCardItem[];
  artifacts?: SolvedArtifactItem[];
  mediaEmbeds?: SolvedMediaEmbedItem[];
  vectors?: SolvedVectorItem[];
  documents?: SolvedDocItem[];
  restyles?: SolvedRestyle[];
  groups?: SolvedGroupItem[];
  connectors?: SolvedConnectorItem[];
  textMutations?: SolvedTextMutation[];
  skeletons?: SpeculativeSkeletonBounds[];
  deletedIds?: string[];
  focusIds?: string[];
  executionTimeMs: number;
  actionSummary: string;
}

export interface ViewportQuery {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CulledContextPayload {
  selectedNodes: SpatialNodeItem[];
  viewportNeighbors: SpatialNodeItem[];
  macroClusters: Array<{
    id: string;
    label?: string;
    bounds: BoundingBox;
    childCount: number;
  }>;
  totalTokenEstimate: number;
  boardIndex?: SpatialNodeItem[];
  recentChanges?: string[];
  omittedCount?: number;
}

// Conversational Agent & DAG Planner Types
export interface DAGMacroNode {
  id: string;
  title: string;
  modality: ModalityType;
  role: string; // e.g. "Research Specialist", "Simulation Engine", "Architecture Designer"
  relative?: string;
  bounds?: { w: number; h: number };
  prompt?: string;
  color?: string;
  status?: 'pending' | 'planning' | 'streaming' | 'completed' | 'error';
}

export interface DAGEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DAGExecutionPlan {
  planId: string;
  title: string;
  nodes: DAGMacroNode[];
  edges?: DAGEdge[];
  summary: string;
}

export interface DAGExecutionNode {
  id: string;
  label: string;
  modality: ModalityType;
  role?: string;
  status: 'pending' | 'planning' | 'streaming' | 'completed' | 'error';
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  thoughtDurationMs?: number;
  dagPlan?: DAGExecutionPlan;
  dagNodes?: DAGExecutionNode[];
  timestamp: number;
  executedActions?: SolvedActionPayload[];
  isStreaming?: boolean;
}

export interface AgentPresenceState {
  isActive: boolean;
  x: number;
  y: number;
  statusText: string;
  role?: string;
  color?: string;
  targetShapeId?: string;
}

export interface MultiAgentPresenceState {
  agentId: string;
  role: string;
  color: string;
  x: number;
  y: number;
  statusText: string;
  isActive: boolean;
}

export interface ProximityHaloItem {
  idA: string;
  idB: string;
  distance: number;
  centerA: { x: number; y: number };
  centerB: { x: number; y: number };
}

export type AIIntentPreset =
  | 'organize'
  | 'connect'
  | 'simulate'
  | 'custom'
  | 'chat';

export type AIProvider = 'gemini' | 'openrouter';

export interface VisualSnapshot {
  mimeType: string;
  base64: string;
  dataUrl?: string;
  width?: number;
  height?: number;
}

export interface AISpatialChatRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  culledContext: CulledContextPayload;
  viewportCenter?: { x: number; y: number };
  provider?: AIProvider;
  model?: string;
  apiKey?: string;
  apiKeys?: string[];
  openRouterApiKey?: string;
  openRouterApiKeys?: string[];
  recentEntities?: Array<{ id: string; type: string; title?: string; summary?: string }>;
  thinkingMode?: boolean;
  temperature?: number;
  swarmMode?: boolean;
  visualSnapshot?: VisualSnapshot;
  viewportInfo?: {
    zoom: number;
    center: { x: number; y: number };
    visibleShapeCount: number;
    bounds?: BoundingBox;
  };
  interactionMode?: 'auto' | 'chat_only' | 'canvas';
  isMakeReal?: boolean;
}

export interface AIMakeRealRequest {
  image?: string; // Data URL or base64; source-only regeneration also supported
  existingCode?: string;
  mimeType?: string;
  prompt?: string;
  provider?: AIProvider;
  model?: string;
  apiKey?: string;
  apiKeys?: string[];
  openRouterApiKey?: string;
  openRouterApiKeys?: string[];
  selectedShapesContext?: Array<{
    id: string;
    type: string;
    title?: string;
    text?: string;
    code?: string;
    language?: string;
    archetype?: string;
    color?: string;
  }>;
}

export interface AISpatialStreamRequest {
  intent: AIIntentPreset;
  prompt?: string;
  culledContext: CulledContextPayload;
  viewportCenter?: { x: number; y: number };
  provider?: AIProvider;
  model?: string;
  apiKey?: string;
  apiKeys?: string[];
  openRouterApiKey?: string;
  openRouterApiKeys?: string[];
}

// Worker Communication Protocol Messages
export type WorkerInMessage =
  | { type: 'SYNC_INDEX'; nodes: SpatialNodeItem[] }
  | { type: 'RUN_ACTIONS'; requestId?: string; actions: SpatialActionFrame[]; viewportCenter?: { x: number; y: number }; sessionId?: string }
  | { type: 'SOLVE_DAG_PLAN'; plan: DAGExecutionPlan; viewportCenter?: { x: number; y: number }; sessionId?: string }
  | { type: 'ALIGN_NODES'; nodeIds: string[]; direction: 'horizontal' | 'vertical' | 'grid'; margin?: number }
  | { type: 'DOCK_NODE'; targetId: string; groupOrAnchorId: string; slot: 'top' | 'bottom' | 'left' | 'right' | 'center'; margin?: number }
  | { type: 'REPEL_COLLISIONS'; anchorId: string; margin?: number }
  | { type: 'QUERY_VIEWPORT'; viewport: ViewportQuery; selectedIds?: string[] }
  | { type: 'STREAM_START'; sessionId: string; viewportCenter?: { x: number; y: number } }
  | { type: 'STREAM_CHUNK'; sessionId: string; chunk: string }
  | { type: 'STREAM_FRAME'; sessionId: string; frame: SpatialActionFrame }
  | { type: 'STREAM_CARD_PATCH'; cardId: string; appendText: string }
  | { type: 'STREAM_END'; sessionId: string }
  | { type: 'STREAM_ABORT'; sessionId: string };

export type WorkerOutMessage =
  | { type: 'INDEX_SYNCED'; count: number }
  | { type: 'LAYOUT_SOLVED'; requestId?: string; result: SolvedLayoutResult }
  | { type: 'DAG_PLAN_SOLVED'; plan: DAGExecutionPlan; skeletons: SpeculativeSkeletonBounds[] }
  | { type: 'VIEWPORT_CULLED'; payload: CulledContextPayload }
  | { type: 'STREAM_ACTION_SOLVED'; sessionId: string; payload: SolvedActionPayload; frameIndex: number }
  | { type: 'STREAM_COMPLETE'; sessionId: string; totalFrames: number; totalDurationMs: number }
  | { type: 'STREAM_ERROR'; sessionId: string; error: string }
  | { type: 'ERROR'; requestId?: string; error: string };
