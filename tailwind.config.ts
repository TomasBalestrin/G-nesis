import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config = {
  darkMode: ["class", '[data-theme="blue-dark"]', '[data-theme="orange-dark"]'],
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
        // shadcn semantic tokens → design.css tokens
        border: "var(--border)",
        input: "var(--input-bd)",
        ring: "var(--primary)",
        background: "var(--bg)",
        foreground: "var(--text)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "#ffffff",
          hover: "var(--primary-h)",
          active: "var(--primary-a)",
          bg: "var(--primary-bg)",
          muted: "var(--primary-mu)",
          text: "var(--primary-tx)",
          border: "var(--primary-bd)",
        },
        secondary: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text)",
        },
        destructive: {
          DEFAULT: "var(--status-error)",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "var(--bg-muted)",
          foreground: "var(--text-2)",
        },
        accent: {
          DEFAULT: "var(--bg-subtle)",
          foreground: "var(--text)",
        },
        popover: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text)",
        },
        card: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text)",
        },
        // design.css direct access
        surface: {
          DEFAULT: "var(--surface)",
          low: "var(--surface-low)",
        },
        bg: {
          DEFAULT: "var(--bg)",
          subtle: "var(--bg-subtle)",
          muted: "var(--bg-muted)",
        },
        text: {
          DEFAULT: "var(--text)",
          2: "var(--text-2)",
          3: "var(--text-3)",
          disabled: "var(--text-dis)",
        },
        status: {
          success: "var(--status-success)",
          "success-bg": "var(--status-success-bg)",
          "success-tx": "var(--status-success-tx)",
          warning: "var(--status-warning)",
          "warning-bg": "var(--status-warning-bg)",
          "warning-tx": "var(--status-warning-tx)",
          error: "var(--status-error)",
          "error-bg": "var(--status-error-bg)",
          "error-tx": "var(--status-error-tx)",
          info: "var(--status-info)",
          "info-bg": "var(--status-info-bg)",
          "info-tx": "var(--status-info-tx)",
        },
        sidebar: {
          bg: "var(--sb-bg)",
          border: "var(--sb-bd)",
          hover: "var(--sb-hover)",
          active: "var(--sb-active)",
          text: "var(--sb-text)",
          "text-active": "var(--sb-text-a)",
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
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
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
