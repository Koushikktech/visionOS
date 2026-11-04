import React from 'react';
import type { WorkspaceOverview } from '../lib/workspaceStudio';

type StudioPreviewProps = {
  mode: 'field-notes' | 'workspace' | 'neutral';
  label: string;
  overview?: WorkspaceOverview | null;
  message?: string;
};

export function StudioPreview({ mode, label, overview, message }: StudioPreviewProps) {
  return (
    <div className={`studio-preview studio-preview--${mode}`} aria-hidden="true">
      <div className="studio-preview__topline">
        <span className="studio-preview__label">{label}</span>
      </div>
      {mode === 'field-notes' ? <FieldNotesComposition /> : null}
      {mode === 'workspace' && overview ? <WorkspaceComposition overview={overview} /> : null}
      {mode === 'neutral' || (mode === 'workspace' && !overview) ? (
        <div className="studio-preview__neutral">
          <span className="studio-preview__neutral-mark" />
          <span>{message ?? 'Your canvas preview will appear here.'}</span>
        </div>
      ) : null}
    </div>
  );
}

function FieldNotesComposition() {
  return (
    <div className="studio-field-notes">
      <div className="studio-field-notes__connector studio-field-notes__connector--one" />
      <div className="studio-field-notes__connector studio-field-notes__connector--two" />
      <div className="studio-field-notes__connector studio-field-notes__connector--three" />

      <article className="studio-artifact studio-artifact--sketch">
        <span className="studio-artifact__caption">A quieter timer</span>
        <div className="studio-sketch-card">
          <div className="studio-sketch-card__screen">25:00</div>
          <div className="studio-sketch-card__button" />
        </div>
        <span className="studio-artifact__underlabel">Sketch</span>
      </article>

      <article className="studio-artifact studio-artifact--app">
        <div className="studio-artifact__chrome"><span />Focus timer</div>
        <div className="studio-timer-card">
          <small>FIELD NOTES</small>
          <div className="studio-timer-card__dial"><strong>25:00</strong><span>time to focus</span></div>
          <div className="studio-timer-card__button">Start</div>
        </div>
        <span className="studio-artifact__underlabel">Working app</span>
      </article>

      <article className="studio-artifact studio-artifact--brief">
        <span className="studio-brief-card__eyebrow">FIELD NOTES</span>
        <strong>Room to focus.</strong>
        <p>A small tool for a more deliberate day.</p>
        <div className="studio-brief-card__rule" />
        <small>THE IDEA</small>
        <i /><i /><i /><i className="studio-brief-card__short" />
        <span className="studio-artifact__underlabel">Project brief</span>
      </article>

      <article className="studio-artifact studio-artifact--note">
        <strong>Keep it simple.</strong>
        <span>One timer. One intention.</span>
        <span>Space for the next idea.</span>
      </article>

      <article className="studio-artifact studio-artifact--slides">
        <span className="studio-brief-card__eyebrow">FIELD NOTES / 01</span>
        <strong>Less noise.<br />More room.</strong>
        <span className="studio-artifact__underlabel">3-slide presentation</span>
        <i /><i />
      </article>
    </div>
  );
}

function previewInk(color: string): string {
  if (!/^#[a-fA-F0-9]{6}$/.test(color)) return '#25303a';
  const linear = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return luminance > .18 ? '#202327' : '#f2f3f5';
}

function WorkspaceComposition({ overview }: { overview: WorkspaceOverview }) {
  const { bounds, shapes } = overview;
  const padding = Math.max(bounds.w, bounds.h) * 0.06;
  const colors: Record<string, string> = {
    black: '#d9e0e7', grey: '#d9e0e7', white: '#f2f3f5', blue: '#b6c9e8',
    'light-blue': '#c9dcee', violet: '#c9bddf', 'light-violet': '#ddd2ed',
    green: '#bfd6c8', 'light-green': '#d2e6ce', yellow: '#e0d1a8', orange: '#e4bc9d',
    red: '#dda6a3', 'light-red': '#ecc6c2',
  };
  const typeLabels: Record<string, string> = { sketch: 'Drawing', shape: 'Shape', connector: 'Connector', note: 'Note', media: 'Media', code: 'Code', slides: 'Slides', document: 'Document', app: 'App' };
  return (
    <svg className="studio-workspace-vector" viewBox={`${bounds.x - padding} ${bounds.y - padding} ${bounds.w + padding * 2} ${bounds.h + padding * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {shapes.map((shape, index) => {
        const fontSize = Math.min(26, shape.w / 12, shape.h / 5);
        const label = shape.title ?? typeLabels[shape.kind];
        return <g key={index}>
          <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h}
            rx={Math.min(16, shape.w / 12, shape.h / 12)}
            fill={/^#[a-fA-F0-9]{6}$/.test(shape.color) ? shape.color : colors[shape.color] ?? '#d9e0e7'}
            fillOpacity={shape.kind === 'connector' || shape.kind === 'sketch' ? 0.35 : 1}
            stroke="#71808c" strokeWidth={1} vectorEffect="non-scaling-stroke"
            strokeDasharray={shape.kind === 'sketch' || shape.kind === 'connector' ? '4 4' : undefined} />
          {shape.w > 90 && shape.h > 45 && <text x={shape.x + shape.w * .06} y={shape.y + fontSize * 1.6} fill={previewInk(shape.color)} fontSize={fontSize} fontFamily="system-ui, sans-serif">{label.length > 28 ? `${label.slice(0, 27)}…` : label}</text>}
        </g>;
      })}
    </svg>
  );
}
