/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        void: 'rgb(var(--color-void) / <alpha-value>)',
        orbit: 'rgb(var(--color-orbit) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        'panel-raised': 'rgb(var(--color-panel-raised) / <alpha-value>)',
        control: 'rgb(var(--color-control) / <alpha-value>)',
        stroke: 'rgb(var(--color-stroke) / <alpha-value>)',
        'stroke-bright': 'rgb(var(--color-stroke-bright) / <alpha-value>)',
        'orbit-track': 'rgb(var(--color-orbit-track) / <alpha-value>)',
        status: {
          success: 'rgb(var(--color-status-success) / <alpha-value>)',
          info: 'rgb(var(--color-status-info) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          warm: 'rgb(var(--color-accent-warm) / <alpha-value>)',
          deep: 'rgb(var(--color-accent-deep) / <alpha-value>)',
          pale: 'rgb(var(--color-accent-pale) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          soft: 'rgb(var(--color-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
          dim: 'rgb(var(--color-ink-dim) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
      backgroundImage: {
        'grid-space': 'var(--bg-grid-space)',
        'accent-gradient': 'var(--bg-accent-gradient)',
        'hero-vignette': 'var(--bg-hero-vignette)',
        'planet-core': 'var(--bg-planet-core)',
        'fund-glow': 'var(--bg-fund-glow)',
        'team-placeholder': 'var(--bg-team-placeholder)',
        'timeline-line': 'var(--bg-timeline-line)',
        scanlines: 'var(--bg-scanlines)',
        'scroll-fade': 'var(--bg-scroll-fade)',
      },
      boxShadow: {
        'card-hover': 'var(--shadow-card-hover)',
        'donate-glow': 'var(--shadow-donate-glow)',
        planet: 'var(--shadow-planet)',
        satellite: 'var(--shadow-satellite)',
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
