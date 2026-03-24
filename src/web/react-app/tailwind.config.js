/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        },
        // Surface colors for glass-panel components
        surface: {
          'border': 'rgba(255, 255, 255, 0.06)',
          'xs': 'rgba(255, 255, 255, 0.01)',
          'sm': 'rgba(255, 255, 255, 0.015)',
          'DEFAULT': 'rgba(255, 255, 255, 0.02)',
          'md': 'rgba(255, 255, 255, 0.025)',
          'lg': 'rgba(255, 255, 255, 0.028)',
          'xl': 'rgba(255, 255, 255, 0.04)',
        },
        // Text opacity colors
        'text-surface': {
          'muted': 'rgba(255, 255, 255, 0.42)',
          'subtle': 'rgba(255, 255, 255, 0.62)',
          'DEFAULT': 'rgba(255, 255, 255, 0.72)',
          'strong': 'rgba(255, 255, 255, 0.78)',
          'emphasis': 'rgba(255, 255, 255, 0.92)',
        },
        // Category colors for memory graph
        category: {
          purple: '#8b5cf6',
          blue: '#3b82f6',
          green: '#10b981',
          orange: '#f59e0b',
          red: '#ef4444',
          gray: '#94a3b8',
          pink: '#ec4899',
          cyan: '#06b6d4',
          lime: '#84cc16',
          violet: '#a855f7',
          slate: '#64748b',
        },
        // Entity type colors for memory graph
        entity: {
          person: '#ec4899',
          technology: '#06b6d4',
          project: '#f59e0b',
          place: '#84cc16',
          organization: '#a855f7',
          concept: '#64748b',
        },
        // Edge colors for memory graph
        edge: {
          'related-to': '#475569',
          'supports': '#10b981',
          'contradicts': '#ef4444',
          'caused-by': '#f59e0b',
          'part-of': '#8b5cf6',
          'has-entity': '#334155',
        },
        // Dialog field colors
        dialog: {
          'bg': 'rgba(255, 255, 255, 0.02)',
          'bg-hover': 'rgba(255, 255, 255, 0.028)',
          'border': 'rgba(255, 255, 255, 0.06)',
          'border-focus': 'rgba(255, 255, 255, 0.12)',
          'text': 'rgba(255, 255, 255, 0.92)',
          'text-muted': 'rgba(255, 255, 255, 0.42)',
          'text-label': 'rgba(255, 255, 255, 0.88)',
          'text-description': 'rgba(255, 255, 255, 0.78)',
          'icon-bg': 'rgba(255, 255, 255, 0.04)',
        }
      },
      // Custom backgroundColor utilities for surface
      backgroundColor: {
        'surface': {
          'xs': 'rgba(255, 255, 255, 0.01)',
          'sm': 'rgba(255, 255, 255, 0.015)',
          'DEFAULT': 'rgba(255, 255, 255, 0.02)',
          'md': 'rgba(255, 255, 255, 0.025)',
          'lg': 'rgba(255, 255, 255, 0.028)',
          'xl': 'rgba(255, 255, 255, 0.04)',
        }
      },
      // Custom borderColor utilities for surface
      borderColor: {
        'surface': 'rgba(255, 255, 255, 0.06)',
      },
      // Custom textColor utilities for surface
      textColor: {
        'surface': {
          'muted': 'rgba(255, 255, 255, 0.42)',
          'subtle': 'rgba(255, 255, 255, 0.62)',
          'DEFAULT': 'rgba(255, 255, 255, 0.72)',
          'strong': 'rgba(255, 255, 255, 0.78)',
          'emphasis': 'rgba(255, 255, 255, 0.92)',
        }
      },
      // Custom fontSize utilities for typography system
      fontSize: {
        'meta': ['10px', { lineHeight: '1', letterSpacing: '0.2em' }],
        'label': ['11px', { lineHeight: '1.2', letterSpacing: '0.22em' }],
        'label-sm': ['11px', { lineHeight: '1.2', letterSpacing: '0.18em' }],
      },
      // Custom letterSpacing utilities
      letterSpacing: {
        'meta': '0.2em',
        'label': '0.22em',
        'label-sm': '0.18em',
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
}
