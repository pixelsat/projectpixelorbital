/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        void: '#040710',
        orbit: '#070C1A',
        panel: '#0B1422',
        'panel-raised': '#10192E',
        control: '#16233C',
        stroke: '#1E2E47',
        'stroke-bright': '#263850',
        'orbit-track': '#93C5FD',
        status: {
          success: '#4ADE80',
          info: '#60A5FA',
        },
        accent: {
          DEFAULT: '#F0C060',
          warm: '#E0A838',
          deep: '#C88A28',
          pale: '#FDE9A8',
        },
        ink: {
          DEFAULT: '#EEF2FF',
          soft: '#B8C6E0',
          muted: '#7A8CAF',
          dim: '#3A4A65',
        },
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
      backgroundImage: {
        'grid-space': 'linear-gradient(rgba(30,46,71,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(30,46,71,.35) 1px, transparent 1px)',
        'accent-gradient': 'linear-gradient(130deg, #F5D070 0%, #E0A838 45%, #FFE8A0 100%)',
        'hero-vignette': 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, #040710 100%)',
        'planet-core': 'radial-gradient(circle at 35% 32%, #1B3B60, #060E1A 72%)',
        'fund-glow': 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(200,136,40,.055) 0%, transparent 65%)',
        'team-placeholder': 'linear-gradient(135deg, #10192E, #16233C)',
        'timeline-line': 'linear-gradient(180deg, transparent 0%, #1E2E47 15%, #1E2E47 85%, transparent 100%)',
        scanlines: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,.04) 3px, rgba(0,0,0,.04) 4px)',
        'scroll-fade': 'linear-gradient(180deg, #7A8CAF, transparent)',
      },
      boxShadow: {
        'card-hover': '0 22px 44px rgba(0,0,0,.35), 0 0 36px rgba(240,192,96,.06)',
        'donate-glow': '0 16px 40px rgba(240,192,96,.25)',
        planet: '0 0 50px rgba(59,130,246,.14), inset 0 0 20px rgba(0,0,0,.6)',
        satellite: '0 0 10px 4px rgba(240,192,96,.55)',
      },
      keyframes: {
        'spin-cw': {
          to: { transform: 'translate(-50%, -50%) rotate(360deg)' },
        },
        'spin-ccw': {
          to: { transform: 'translate(-50%, -50%) rotate(-360deg)' },
        },
        'sat-travel': {
          from: { transform: 'rotate(0deg) translateX(var(--r)) rotate(0deg)' },
          to: { transform: 'rotate(360deg) translateX(var(--r)) rotate(-360deg)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(28px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'spin-cw': 'spin-cw 55s linear infinite',
        'spin-ccw': 'spin-ccw 38s linear infinite',
        'spin-med': 'spin-cw 22s linear infinite',
        'sat-travel': 'sat-travel 22s linear infinite',
        'fade-up': 'fade-up .9s ease forwards',
        blink: 'blink 1.1s step-end infinite',
      },
    },
  },
};
