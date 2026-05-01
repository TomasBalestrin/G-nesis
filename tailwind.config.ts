import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config = {
  // Tema padrão é Azul Dark em :root. Alternância para Azul Light via
  // attribute [data-theme="light"] no <html> (gerenciado por useTheme).
  // Ainda assim, declaramos darkMode pra Tailwind interpretar `dark:` como
  // "default" — usado em zero lugares hoje, mas seguro deixar configurado.
  darkMode: ["selector", ":root:not([data-theme='light'])"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  // Type scale do Elite Premium (B3): classes `.type-*` vivem em
  // @layer utilities pra garantir prioridade sobre Tailwind base, mas
  // o JIT purger só preserva o que aparece em `content`. Componentes
  // novos vão referenciar essas classes; safelist mantém elas no
  // bundle mesmo antes de algum consumer chegar.
  safelist: [
    "type-hero",
    "type-h1",
    "type-h2",
    "type-body",
    "type-label",
    "type-meta",
    "type-value",
    "type-brand",
    "font-display",
    "font-body",
    "font-mono",
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
        // Slots semânticos shadcn/Radix → tokens do design system.
        border: "var(--border)",
        input: "var(--border)",
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
          DEFAULT: "var(--surface-low)",
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
          DEFAULT: "var(--primary)",
          foreground: "#ffffff",
          hover: "var(--primary-h)",
          soft: "var(--primary-bg)",
        },
        popover: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text)",
        },
        card: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text)",
        },
        // Atalhos para os tokens v3 mais comuns.
        surface: {
          DEFAULT: "var(--surface)",
          low: "var(--surface-low)",
        },
        bg: {
          DEFAULT: "var(--bg)",
          primary: "var(--bg)",
          secondary: "var(--surface)",
          tertiary: "var(--bg-muted)",
          hover: "var(--bg-muted)",
          subtle: "var(--bg-subtle)",
          muted: "var(--bg-muted)",
        },
        text: {
          DEFAULT: "var(--text)",
          primary: "var(--text)",
          secondary: "var(--text-2)",
          tertiary: "var(--text-3)",
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
          text: "var(--code-tx)",
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        DEFAULT: "var(--radius-base)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        "3xl": "var(--radius-3xl)",
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
