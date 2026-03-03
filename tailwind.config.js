/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'claude': {
          'bg': 'rgb(var(--c-bg) / <alpha-value>)',
          'surface': 'rgb(var(--c-surface) / <alpha-value>)',
          'surface-light': 'rgb(var(--c-surface-light) / <alpha-value>)',
          'border': 'rgb(var(--c-border) / <alpha-value>)',
          'primary': 'rgb(var(--c-primary) / <alpha-value>)',
          'primary-light': 'rgb(var(--c-primary-light) / <alpha-value>)',
          'primary-dark': 'rgb(var(--c-primary-dark) / <alpha-value>)',
          'accent': 'rgb(var(--c-accent) / <alpha-value>)',
          'accent-light': 'rgb(var(--c-accent-light) / <alpha-value>)',
          'text': 'rgb(var(--c-text) / <alpha-value>)',
          'text-muted': 'rgb(var(--c-text-muted) / <alpha-value>)',
          'text-dim': 'rgb(var(--c-text-dim) / <alpha-value>)',
          'glow': 'var(--c-glow)',
          'glow-pink': 'var(--c-glow-pink)',
        }
      },
      boxShadow: {
        'glow': '0 0 12px rgba(86, 156, 214, 0.12)',
        'glow-sm': '0 0 6px rgba(86, 156, 214, 0.08)',
        'glow-pink': '0 0 12px rgba(197, 134, 192, 0.12)',
        'glow-pink-sm': '0 0 6px rgba(197, 134, 192, 0.08)',
        'panel': '0 4px 12px rgba(0, 0, 0, 0.3)',
      },
      backgroundImage: {
        'gradient-surface': 'linear-gradient(135deg, #252526 0%, #2d2d2d 100%)',
        'gradient-primary': 'linear-gradient(135deg, #264f78 0%, #569cd6 100%)',
        'gradient-accent': 'linear-gradient(135deg, #858585 0%, #d4d4d4 100%)',
        'gradient-user': 'linear-gradient(135deg, #264f78 0%, #2b5a83 100%)',
        'gradient-mixed': 'linear-gradient(135deg, #569cd6 0%, #6cb6ff 100%)',
      },
    },
  },
  plugins: [],
}
