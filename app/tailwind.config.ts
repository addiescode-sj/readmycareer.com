import type { Config } from "tailwindcss";

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        /* ── shadcn base ── */
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          container: "hsl(var(--primary-container))",
          "container-foreground": "hsl(var(--on-primary-container))",
          fixed: "hsl(var(--primary-fixed))",
          "fixed-dim": "hsl(var(--primary-fixed-dim))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
          container: "hsl(var(--secondary-container))",
          "container-foreground": "hsl(var(--on-secondary-container))",
        },
        tertiary: {
          DEFAULT: "hsl(var(--tertiary))",
          foreground: "hsl(var(--on-tertiary))",
          container: "hsl(var(--tertiary-container))",
          "container-foreground": "hsl(var(--on-tertiary-container))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          container: "hsl(var(--error-container))",
          "container-foreground": "hsl(var(--on-error-container))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* ── Synthetic Intelligence surface scale ── */
        surface: {
          DEFAULT: "hsl(var(--surface))",
          dim: "hsl(var(--surface-dim))",
          bright: "hsl(var(--surface-bright))",
          lowest: "hsl(var(--surface-container-lowest))",
          low: "hsl(var(--surface-container-low))",
          container: "hsl(var(--surface-container))",
          high: "hsl(var(--surface-container-high))",
          highest: "hsl(var(--surface-container-highest))",
          variant: "hsl(var(--surface-variant))",
          tint: "hsl(var(--surface-tint))",
        },
        "on-surface": "hsl(var(--on-surface))",
        "on-surface-variant": "hsl(var(--on-surface-variant))",
        "inverse-surface": "hsl(var(--inverse-surface))",
        "inverse-on-surface": "hsl(var(--inverse-on-surface))",
        outline: {
          DEFAULT: "hsl(var(--outline))",
          variant: "hsl(var(--outline-variant))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      spacing: {
        xs: "8px",
        sm: "16px",
        md: "24px",
        lg: "48px",
        xl: "80px",
        gutter: "24px",
        margin: "32px",
      },
      fontSize: {
        "display-xl": ["60px", { lineHeight: "72px", letterSpacing: "-0.02em", fontWeight: "800" }],
        "headline-lg": ["36px", { lineHeight: "44px", letterSpacing: "-0.01em", fontWeight: "700" }],
        "headline-md": ["24px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "28px", letterSpacing: "0" }],
        "body-md": ["16px", { lineHeight: "24px", letterSpacing: "0" }],
        "label-sm": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "synthetic-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "insight-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "insight-out": {
          from: { opacity: "1", transform: "translateY(0) scale(1)" },
          to: { opacity: "0", transform: "translateY(-12px) scale(0.97)" },
        },
        "pulse-ring": {
          "0%, 100%": { filter: "drop-shadow(0 0 8px rgba(139,92,246,0.4))" },
          "50%": { filter: "drop-shadow(0 0 20px rgba(139,92,246,0.8))" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "synthetic-spin": "synthetic-spin 1.2s linear infinite",
        "insight-in": "insight-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
        "insight-out": "insight-out 0.3s ease-in both",
        "pulse-ring": "pulse-ring 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        display: ["Inter", "sans-serif"],
      },
      boxShadow: {
        "synthetic": "0 0 15px 0 rgba(139,92,246,0.15)",
        "synthetic-md": "0 0 20px 0 rgba(139,92,246,0.25)",
        "synthetic-lg": "0 0 30px 4px rgba(139,92,246,0.3)",
        "glass": "0 4px 24px 0 rgba(107,56,212,0.08), 0 1px 2px 0 rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
