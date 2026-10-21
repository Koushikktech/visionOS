import { ArtifactShapeUtil } from './ArtifactShapeUtil';
import { RichCardShapeUtil } from './RichCardShapeUtil';
import { CodeCardShapeUtil } from './CodeCardShapeUtil';
import { MediaEmbedShapeUtil } from './MediaEmbedShapeUtil';
import { VectorShapeUtil } from './VectorShapeUtil';
import { DocShapeUtil } from './DocShapeUtil';
import { SlideDeckShapeUtil } from './SlideDeckShapeUtil';

export const customShapeUtils = [
  ArtifactShapeUtil,
  RichCardShapeUtil,
  CodeCardShapeUtil,
  MediaEmbedShapeUtil,
  VectorShapeUtil,
  DocShapeUtil,
  SlideDeckShapeUtil,
];

export {
  ArtifactShapeUtil,
  RichCardShapeUtil,
  CodeCardShapeUtil,
  MediaEmbedShapeUtil,
  VectorShapeUtil,
  DocShapeUtil,
  SlideDeckShapeUtil,
};

export type { TLArtifactShape } from './ArtifactShapeUtil';
export type { TLRichCardShape } from './RichCardShapeUtil';
export type { TLCodeCardShape } from './CodeCardShapeUtil';
export type { TLMediaEmbedShape } from './MediaEmbedShapeUtil';
export type { TLVectorShape } from './VectorShapeUtil';
export type { TLDocShape } from './DocShapeUtil';
export type { TLSlideDeckShape } from './SlideDeckShapeUtil';
