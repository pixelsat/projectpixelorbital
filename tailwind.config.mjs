/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        sp: {
          950: '#040710',
          900: '#070C1A',
          800: '#0B1422',
          700: '#10192E',
          600: '#16233C',
          500: '#1E2E47',
          400: '#263850',
        },
        amber: {
          glow: '#F0C060',
          mid: '#E0A838',
          deep: '#C88A28',
          pale: '#FDE9A8',
        },
        frost: {
          100: '#EEF2FF',
          300: '#B8C6E0',
          500: '#7A8CAF',
          700: '#3A4A65',
        },
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
      backgroundImage: {
        'grid-space': 'linear-gradient(rgba(30,46,71,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(30,46,71,.35) 1px, transparent 1px)',
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
