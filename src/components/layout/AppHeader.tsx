import { Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { Link } from "react-router-dom";

import { useTheme } from "@/hooks/useTheme";

/**
 * Topo do conteúdo principal — 103px de altura conforme
 * `--gv2-header-height`. Acomoda os controles globais (Settings +
 * theme toggle) que antes moravam no rodapé da sidebar. Layout
 * minimalista: faixa branca, borda inferior usando `--gv2-border`.
 *
 * Centro intencionalmente vazio por enquanto; cada rota pode injetar
 * seu próprio título/ações via portal/slot quando precisarmos.
 */
export function AppHeader() {
  const { isDark, toggle } = useTheme();
  return (
    <header
      className="flex shrink-0 items-center justify-end gap-3 border-b px-[30px]"
      style={{
        height: "var(--gv2-header-height)",
        borderColor: "var(--gv2-border)",
        background: "var(--gv2-bg)",
      }}
    >
      <Link
        to="/settings"
        aria-label="Configurações"
        className="rounded-full p-2 text-[var(--gv2-text-secondary)] transition-colors hover:bg-[var(--gv2-active-bg)] hover:text-[var(--gv2-active-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
      >
        <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </Link>
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
        className="rounded-full p-2 text-[var(--gv2-text-secondary)] transition-colors hover:bg-[var(--gv2-active-bg)] hover:text-[var(--gv2-active-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
      >
        {isDark ? (
          <Sun className="h-[18px] w-[18px]" strokeWidth={1.5} />
        ) : (
          <Moon className="h-[18px] w-[18px]" strokeWidth={1.5} />
        )}
      </button>
    </header>
  );
}
