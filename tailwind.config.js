/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/shapes/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090a0f',
        canvas: '#0f1117',
        obsidian: {
          DEFAULT: '#121218',
          50: 'rgba(255, 255, 255, 0.04)',
          100: '#1c1c24',
          200: '#181820',
          300: '#14141c',
          400: '#121218',
          500: '#0e0e14',
          600: '#0a0a0e',
          glass: {
            dock: 'rgba(18, 18, 24, 0.78)',
            'dock-end': 'rgba(24, 24, 32, 0.85)',
            pill: 'rgba(18, 18, 24, 0.82)',
            popover: 'rgba(18, 18, 24, 0.92)',
            card: 'rgba(18, 18, 24, 0.80)',
            code: 'rgba(12, 12, 16, 0.85)',
            elevated: 'rgba(20, 20, 28, 0.85)',
          },
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'Menlo',
          'Monaco',
          'monospace',
        ],
      },
      boxShadow: {
        'glass-dock': '0 20px 50px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
        'glass-pill': '0 10px 30px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
        'glass-popover': '0 24px 60px rgba(0, 0, 0, 0.7), 0 1px 0 rgba(255, 255, 255, 0.12) inset',
        'glass-card': '0 20px 50px -10px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
        'glass-elevated': '0 24px 50px rgba(0, 0, 0, 0.65), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
      },
      transitionTimingFunction: {
        'apple-ease': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      minHeight: {
        'touch-desktop': '40px',
        'touch-mobile': '44px',
      },
      minWidth: {
        'touch-desktop': '40px',
        'touch-mobile': '44px',
      },
      scale: {
        press: '0.96',
      },
    },
  },
  plugins: [],
};
