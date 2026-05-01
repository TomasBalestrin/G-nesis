import { useState } from "react";
import {
  ChevronDown,
  MessageSquarePlus,
  MoreVertical,
  PanelLeft,
  Plus,
} from "lucide-react";

import { cn } from "@/lib/utils";

import "./EliteSidebar.css";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  active?: boolean;
  /** Quando presente, click navega via prop callback do consumer. */
  href?: string;
}

export interface SidebarSection {
  id: string;
  label: string;
  items: SidebarItem[];
  /** Quando true, mostra o botão `+` ao lado do título (ex: criar
   *  novo chat dentro daquela seção). */
  addAction?: boolean;
}

export interface EliteSidebarProps {
  /** Texto da brand top-left. Default 'Genesis'. */
  brand?: string;
  sections: SidebarSection[];
  /** Citação do rodapé. `quote` + `author` se ambos presentes. */
  quote?: { text: string; author: string };
  /** Click handler do botão "Nova Conversa". Sem callback = botão ainda
   *  renderiza mas é noop (caller pode plugar depois). */
  onNewConversation?: () => void;
  /** Click handler do ícone de painel (recolher/expandir futuro). */
  onTogglePanel?: () => void;
  /** Notifica o consumer quando um item é clicado. Recebe o item.id
   *  pra fazer roteamento próprio (hash, react-router, etc). */
  onItemClick?: (id: string) => void;
  /** Notifica quando o `+` de uma seção é clicado. */
  onSectionAdd?: (sectionId: string) => void;
}

/**
 * Sidebar — Elite Premium (DESIGN.md + design system.html).
 *
 * 248px fixed, dark bg, brand gold, nav com seções colapsáveis. NÃO
 * tem dependência de roteamento — o consumer fornece `onItemClick`
 * + flag `active` por item pra controle externo. Coexiste com a
 * Sidebar legacy (`src/components/layout/Sidebar.tsx`) que usa
 * shadcn + tokens antigos. Migração: substituir <Sidebar /> por
 * <EliteSidebar /> em MainLayout depois de plugar conversations
 * store + skills store nos `sections` props.
 *
 * Estado local: collapsed map por section.id pra preservar a
 * preferência do usuário entre re-renders (mas não entre sessões;
 * persistência via localStorage fica pra task futura).
 */
export function EliteSidebar({
  brand = "Genesis",
  sections,
  quote,
  onNewConversation,
  onTogglePanel,
  onItemClick,
  onSectionAdd,
}: EliteSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggleSection(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside className="sb" aria-label="Navegação principal">
      <div className="sb-top">
        <div className="sb-brand">{brand}</div>
        {onTogglePanel ? (
          <button
            type="button"
            className="sb-panel-btn"
            onClick={onTogglePanel}
            title="Painel"
            aria-label="Recolher sidebar"
          >
            <PanelLeft />
          </button>
        ) : null}
      </div>

      <button type="button" className="sb-new" onClick={onNewConversation}>
        <MessageSquarePlus />
        Nova Conversa
      </button>

      <nav className="sb-nav">
        {sections.map((section) => {
          const isCollapsed = collapsed[section.id] === true;
          return (
            <div key={section.id}>
              <div className="sb-sec">
                <button
                  type="button"
                  className={cn("sb-sec-left", isCollapsed && "collapsed")}
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={!isCollapsed}
                >
                  <ChevronDown />
                  {section.label}
                </button>
                {section.addAction ? (
                  <button
                    type="button"
                    className="sb-sec-btn"
                    onClick={() => onSectionAdd?.(section.id)}
                    aria-label={`Adicionar em ${section.label}`}
                  >
                    <Plus />
                  </button>
                ) : null}
              </div>
              {isCollapsed
                ? null
                : section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn("sb-item", item.active && "on")}
                        onClick={() => onItemClick?.(item.id)}
                        aria-current={item.active ? "page" : undefined}
                      >
                        {Icon ? <Icon /> : null}
                        <span>{item.label}</span>
                        <span className="sb-more">
                          <MoreVertical />
                        </span>
                      </button>
                    );
                  })}
            </div>
          );
        })}
      </nav>

      {quote ? (
        <div className="sb-foot">
          <div className="sb-quote">{`"${quote.text}"`}</div>
          <div className="sb-quote-author">{quote.author}</div>
        </div>
      ) : null}
    </aside>
  );
}
