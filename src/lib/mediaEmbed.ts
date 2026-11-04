export interface SafeMediaUrl {
  href: string;
  hostname: string;
}

export type MediaEmbedPlan =
  | { kind: 'youtube'; url: SafeMediaUrl; videoId: string }
  | { kind: 'audio'; url: SafeMediaUrl }
  | { kind: 'unsupported'; url: SafeMediaUrl | null };

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

export function parseSafeMediaUrl(raw: string): SafeMediaUrl | null {
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      !parsed.hostname
    ) {
      return null;
    }
    return { href: parsed.href, hostname: parsed.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

export function extractYouTubeVideoId(raw: string): string | null {
  const safeUrl = parseSafeMediaUrl(raw);
  if (!safeUrl || !YOUTUBE_HOSTS.has(safeUrl.hostname)) return null;

  const parsed = new URL(safeUrl.href);
  const path = parsed.pathname.split('/').filter(Boolean);
  let candidate: string | null = null;
  if (safeUrl.hostname === 'youtu.be') {
    candidate = path[0] ?? null;
  } else if (parsed.pathname === '/watch') {
    candidate = parsed.searchParams.get('v');
  } else if (['embed', 'shorts', 'live'].includes(path[0] ?? '')) {
    candidate = path[1] ?? null;
  }

  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

export function resolveMediaEmbedPlan(
  raw: string,
  mediaType: 'youtube' | 'web' | 'audio'
): MediaEmbedPlan {
  const url = parseSafeMediaUrl(raw);
  if (!url) return { kind: 'unsupported', url: null };

  const videoId = extractYouTubeVideoId(url.href);
  if (videoId && (mediaType === 'youtube' || YOUTUBE_HOSTS.has(url.hostname))) {
    return { kind: 'youtube', url, videoId };
  }
  if (mediaType === 'audio') return { kind: 'audio', url };
  return { kind: 'unsupported', url };
}
