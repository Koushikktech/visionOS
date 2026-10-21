/**
 * CanvasOS Apple Design System Tokens & Helper Utilities
 * Strictly grounded in Apple Human Interface Guidelines and tactile design engineering principles.
 */

/**
 * Concentric border radius helper:
 * For nested containers to look optically harmonious, the outer border radius
 * must equal the inner border radius plus the padding between them:
 *   outer = inner + padding
 *
 * @param innerRadius The border radius of the child/inner container (px)
 * @param padding The padding or gap between inner and outer container (px)
 * @returns The mathematically concentric outer border radius (px)
 */
export function getConcentricRadius(innerRadius: number, padding: number): number {
  return Math.max(0, innerRadius + padding);
}

/**
 * Calculates the concentric inner radius given the outer container radius and padding.
 *   inner = max(0, outer - padding)
 *
 * @param outerRadius The border radius of the outer container (px)
 * @param padding The padding or gap between containers (px)
 * @returns The inner radius (px)
 */
export function getInnerConcentricRadius(outerRadius: number, padding: number): number {
  return Math.max(0, outerRadius - padding);
}

/**
 * Minimum touch / click target dimension for dense desktop interfaces (pixels).
 * Apple HIG & tactile design principles specify >= 40x40px for desktop.
 */
export const MIN_TOUCH_TARGET = 40;

/**
 * Recommended touch / click target dimension for mobile / standard touch contexts (pixels).
 * Apple HIG standard minimum touch target.
 */
export const RECOMMENDED_TOUCH_TARGET = 44;

/**
 * Apple tactile micro-interaction constants.
 */
export const PRESS_SCALE = 0.96;

/**
 * Apple fluid easing curve for CSS transitions.
 */
export const APPLE_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Apple-grade spring transition configuration for framer-motion.
 * Restrained motion with zero bounce to prevent animated clutter.
 */
export const APPLE_SPRING = {
  type: 'spring',
  duration: 0.3,
  bounce: 0,
} as const;

/**
 * Icon stroke weight matching rules:
 * - 1.5px stroke beside regular (400) text
 * - 2.0px stroke beside semibold (600) text
 */
export const ICON_STROKE_WEIGHTS = {
  regular: 1.5,
  semibold: 2.0,
} as const;

/**
 * System font typography stacks.
 */
export const FONT_STACKS = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif',
  mono: '"SF Mono", Menlo, Monaco, monospace',
} as const;

/**
 * visionOS Spatial Intelligence obsidian dark glass color constants & swatches.
 */
export const APPLE_GLASS = {
  dock: {
    bgStart: 'rgba(18, 18, 24, 0.78)',
    bgEnd: 'rgba(24, 24, 32, 0.85)',
    border: 'rgba(255, 255, 255, 0.10)',
    blur: 'blur(40px) saturate(190%)',
    shadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
  },
  pill: {
    bg: 'rgba(18, 18, 24, 0.82)',
    border: 'rgba(255, 255, 255, 0.10)',
    blur: 'blur(30px) saturate(180%)',
    shadow: '0 10px 30px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
  },
  popover: {
    bg: 'rgba(18, 18, 24, 0.92)',
    border: 'rgba(255, 255, 255, 0.12)',
    blur: 'blur(40px)',
    shadow: '0 24px 60px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.12) inset',
  },
  card: {
    bg: 'rgba(18, 18, 24, 0.80)',
    border: 'rgba(255, 255, 255, 0.10)',
    borderHover: 'rgba(255, 255, 255, 0.16)',
    blur: 'blur(28px) saturate(180%)',
    shadow: '0 20px 50px -10px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.10) inset',
  },
  header: {
    bg: 'rgba(255, 255, 255, 0.03)',
    border: 'rgba(255, 255, 255, 0.08)',
  },
  codeBg: 'rgba(12, 12, 16, 0.85)',
  elevated: {
    bg: 'rgba(20, 20, 28, 0.85)',
    border: 'rgba(255, 255, 255, 0.10)',
    blur: 'blur(36px) saturate(190%)',
    shadow: '0 24px 50px rgba(0, 0, 0, 0.65), 0 1px 0 rgba(255, 255, 255, 0.10) inset',
  },
} as const;

/**
 * Maps an arbitrary hex color code to the closest standard tldraw DefaultColorStyle value.
 */
export function mapHexToTldrawColor(hex: string): string {
  if (!hex || !hex.startsWith('#')) return 'black';
  const clean = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(clean.slice(1, 3), 16) || 0;
  const g = parseInt(clean.slice(3, 5), 16) || 0;
  const b = parseInt(clean.slice(5, 7), 16) || 0;

  const PALETTE: Record<string, [number, number, number]> = {
    white: [248, 250, 252],
    grey: [148, 163, 184],
    black: [30, 41, 59],
    blue: [59, 130, 246],
    violet: [139, 92, 246],
    green: [34, 197, 94],
    yellow: [250, 204, 21],
    orange: [249, 115, 22],
    red: [239, 68, 68],
  };

  let best = 'black';
  let minDistance = Infinity;

  for (const [name, [pr, pg, pb]] of Object.entries(PALETTE)) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < minDistance) {
      minDistance = d;
      best = name;
    }
  }

  return best;
}
