import { useEffect } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { NavLink, useParams } from "react-router-dom";

import { useSkillsStore } from "@/stores/skillsStore";
import type { Skill } from "@/types/skill";

/**
 * 3º painel do Settings — só montado em /settings/skill/:name. Lista
 * todas as skills com a ativa expandida mostrando os arquivos da pasta
 * v2 (SKILL.md / references / assets / scripts). Mesma largura do
 * menu (315px), padding 30px, separador 1px var(--gv2-border) entre
 * skills.
 *
 * NavLink leva pra /settings/skill/:name (rota nested do Settings).
 * Não duplicamos as ações da sidebar (editar/exportar/deletar) — quem
 * tem precedência sobre arquivos é o detail panel à direita.
 */
export function SkillTreePanel() {
  const items = useSkillsStore((s) => s.items);
  const loading = useSkillsStore((s) => s.loading);
  const loaded = useSkillsStore((s) => s.loaded);
  const ensureLoaded = useSkillsStore((s) => s.ensureLoaded);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  return (
    <aside
      aria-label="Árvore de skills"
      className="flex shrink-0 flex-col overflow-y-auto border-r"
      style={{
        width: "var(--gv2-panel-width)",
        padding: "30px",
        borderColor: "var(--gv2-border)",
        background: "var(--gv2-bg)",
      }}
    >
      <h2
        style={{
          fontFamily: "Lora, Georgia, serif",
          fontWeight: 600,
          fontSize: "25px",
          color: "var(--gv2-text)",
          marginBottom: "30px",
        }}
      >
        Skill
      </h2>

      {loading && !loaded ? (
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            color: "var(--gv2-text-secondary)",
          }}
        >
          Carregando...
        </p>
      ) : items.length === 0 ? (
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            color: "var(--gv2-text-secondary)",
          }}
        >
          Nenhuma skill.
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((skill, idx) => (
            <li key={skill.name} className="flex flex-col">
              <SkillRow skill={skill} />
              {idx < items.length - 1 ? (
                <div
                  aria-hidden
                  style={{
                    height: "1px",
                    margin: "10px 0",
                    background: "var(--gv2-border)",
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function SkillRow({ skill }: { skill: Skill }) {
  const { name: routeName } = useParams<{ name: string }>();
  const isActive = routeName === skill.name;

  return (
    <>
      <NavLink
        to={`/settings/skill/${encodeURIComponent(skill.name)}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "15px 25px",
          borderRadius: "var(--gv2-radius-sm)",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
          background: isActive ? "var(--gv2-active-bg)" : "transparent",
          color: isActive
            ? "var(--gv2-active-text)"
            : "var(--gv2-text-secondary)",
          transition: "background-color 120ms, color 120ms",
        }}
      >
        <ChevronDown
          className="shrink-0"
          style={{
            width: "8px",
            height: "4px",
            transform: isActive ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
          strokeWidth={2}
        />
        <FileText
          className="shrink-0"
          style={{ width: "10px", height: "12px" }}
          strokeWidth={1.5}
        />
        <span className="flex-1 truncate font-mono">{skill.name}</span>
      </NavLink>
      {isActive ? <SkillSubItems skill={skill} /> : null}
    </>
  );
}

function SkillSubItems({ skill }: { skill: Skill }) {
  const items: string[] = ["SKILL.md"];
  if (skill.has_references) items.push("references/");
  if (skill.has_assets) items.push("assets/");
  if (skill.has_scripts) items.push("scripts/");
  return (
    <ul>
      {items.map((label) => (
        <li
          key={label}
          style={{
            paddingLeft: "39px",
            paddingTop: "5px",
            paddingBottom: "5px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "13px",
            color: "var(--gv2-active-text)",
          }}
        >
          {label}
        </li>
      ))}
    </ul>
  );
}
