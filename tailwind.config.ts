import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config = {
  // Dark theme is toggled via `.dark` on <html> (managed by useTheme).
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Semantic shadcn slots wired to the new token system.
        border: "var(--border)",
        input: "var(--border)",
        ring: "var(--accent)",
        background: "var(--bg-primary)",
        foreground: "var(--text-primary)",
        primary: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-contrast)",
          hover: "var(--accent-hover)",
          active: "var(--accent-hover)",
          bg: "var(--accent-soft)",
          muted: "var(--accent-soft)",
          text: "var(--accent)",
          border: "var(--accent)",
        },
        secondary: {
          DEFAULT: "var(--bg-secondary)",
          foreground: "var(--text-primary)",
        },
        destructive: {
          DEFAULT: "var(--error)",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "var(--bg-tertiary)",
          foreground: "var(--text-secondary)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-contrast)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
        },
        popover: {
          DEFAULT: "var(--bg-secondary)",
          foreground: "var(--text-primary)",
        },
        card: {
          DEFAULT: "var(--bg-secondary)",
          foreground: "var(--text-primary)",
        },
        // Direct access to the v3 token names.
        surface: {
          DEFAULT: "var(--bg-primary)",
          low: "var(--bg-secondary)",
        },
        bg: {
          DEFAULT: "var(--bg-primary)",
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          tertiary: "var(--bg-tertiary)",
          hover: "var(--bg-hover)",
          subtle: "var(--bg-secondary)",
          muted: "var(--bg-tertiary)",
        },
        text: {
          DEFAULT: "var(--text-primary)",
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          2: "var(--text-secondary)",
          3: "var(--text-tertiary)",
          disabled: "var(--text-tertiary)",
        },
        status: {
          success: "var(--success)",
          "success-bg": "var(--success-soft)",
          "success-tx": "var(--success)",
          warning: "var(--warning)",
          "warning-bg": "var(--warning-soft)",
          "warning-tx": "var(--warning)",
          error: "var(--error)",
          "error-bg": "var(--error-soft)",
          "error-tx": "var(--error)",
          info: "var(--info)",
          "info-bg": "var(--info-soft)",
          "info-tx": "var(--info)",
        },
        sidebar: {
          bg: "var(--sidebar-bg)",
          border: "var(--border)",
          hover: "var(--bg-hover)",
          active: "var(--accent-soft)",
          text: "var(--text-secondary)",
          "text-active": "var(--accent)",
        },
        tool: {
          bash: "var(--tool-bash)",
          "bash-soft": "var(--tool-bash-soft)",
          "claude-code": "var(--tool-claude-code)",
          "claude-code-soft": "var(--tool-claude-code-soft)",
          api: "var(--tool-api)",
          "api-soft": "var(--tool-api-soft)",
        },
        chat: {
          "user-bg": "var(--chat-user-bg)",
          "user-text": "var(--chat-user-text)",
        },
        code: {
          bg: "var(--code-bg)",
          text: "var(--code-text)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        DEFAULT: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        "3xl": "24px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        acc: "var(--shadow-acc)",
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
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 150ms ease-out",
        "spin-slow": "spin 1.2s linear infinite",
      },
      transitionDuration: {
        sidebar: "200ms",
        modal: "150ms",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
