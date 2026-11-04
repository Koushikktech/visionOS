import { describe, expect, it } from 'bun:test';
import { extractYouTubeVideoId, parseSafeMediaUrl, resolveMediaEmbedPlan } from './mediaEmbed';

describe('media embed provider validation', () => {
  it('accepts known YouTube URL forms on exact supported hosts', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=4')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(resolveMediaEmbedPlan('https://youtube.com/embed/dQw4w9WgXcQ', 'web').kind).toBe('youtube');
  });

  it('rejects lookalike hosts, malformed IDs, unsafe protocols, and credentials', () => {
    expect(extractYouTubeVideoId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(extractYouTubeVideoId('https://youtu.be.evil.test/dQw4w9WgXcQ')).toBeNull();
    expect(extractYouTubeVideoId('https://evil.test/?next=youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseSafeMediaUrl('javascript:alert(1)')).toBeNull();
    expect(parseSafeMediaUrl('https://user:secret@example.test/media.mp3')).toBeNull();
  });

  it('does not pretend arbitrary web sites can be embedded', () => {
    expect(resolveMediaEmbedPlan('https://example.test/page', 'web')).toEqual({
      kind: 'unsupported',
      url: { href: 'https://example.test/page', hostname: 'example.test' },
    });
    expect(resolveMediaEmbedPlan('not a URL', 'audio')).toEqual({ kind: 'unsupported', url: null });
  });
});
