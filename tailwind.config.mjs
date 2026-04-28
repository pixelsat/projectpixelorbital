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
        status: {
          success: 'rgb(var(--color-status-success) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          deep: 'rgb(var(--color-accent-deep) / <alpha-value>)',
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
        'fund-glow': 'var(--bg-fund-glow)',
        'team-placeholder': 'var(--bg-team-placeholder)',
        scanlines: 'var(--bg-scanlines)',
      },
      boxShadow: {
        'card-hover': 'var(--shadow-card-hover)',
        'donate-glow': 'var(--shadow-donate-glow)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(28px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .9s ease forwards',
      },
    },
  },
};
