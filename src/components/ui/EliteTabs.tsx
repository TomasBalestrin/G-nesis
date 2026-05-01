import "./EliteTabs.css";

export interface TabItem {
  id: string;
  label: React.ReactNode;
}

export interface EliteTabsProps {
  tabs: TabItem[];
  /** Id da tab ativa. Controlled — caller decide; component só
   *  emite `onChange`. */
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  /** A11y label do role="tablist". Default 'Abas'. */
  ariaLabel?: string;
}

/**
 * Tabs — Elite Premium (DESIGN.md §11).
 *
 * Toggle horizontal sem underline. Active = bg surface 2 + texto
 * full color. Componente puro (controlled): caller controla
 * `activeId` e plumbing pra trocar o conteúdo da página/seção.
 *
 * `role="tablist"` + cada item `role="tab"` + `aria-selected` pra
 * leitores de tela. Pra ligar com painéis, o caller usa
 * `aria-controls` no item via spread (ainda não suportado direto;
 * fica pra task que precise do controle keyboard arrows entre
 * tabs aninhadas).
 */
export function EliteTabs({
  tabs,
  activeId,
  onChange,
  className,
  ariaLabel = "Abas",
}: EliteTabsProps) {
  const classes = ["tb", className].filter(Boolean).join(" ");
  return (
    <div role="tablist" aria-label={ariaLabel} className={classes}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const itemClasses = ["tb-i", isActive ? "on" : null]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={itemClasses}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
