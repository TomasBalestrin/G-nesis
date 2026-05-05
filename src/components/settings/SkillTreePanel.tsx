import { useEffect } from "react";
import { ChevronDown, FileText, PanelLeftClose } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useSkillsStore, type SelectedSkillFile } from "@/stores/skillsStore";
import type { Skill } from "@/types/skill";

/**
 * 3º painel do Settings — só montado em /settings/skill/:name. Lista
 * todas as skills com a ativa expandida mostrando os arquivos reais
 * (SKILL.md + references). Mesma largura do menu (315px), padding
 * 30px, separador 1px var(--gv2-border) entre skills.
 *
 * Header "Skill" Lora SemiBold 25px var(--gv2-brand) com ícone
 * collapse à direita (clicar volta pra /settings/skills, fechando o
 * 3º painel). Sub-itens disparam `setSelectedFile` no store — o
 * SkillDetailView observa e troca o conteúdo do card.
 */
export function SkillTreePanel() {
  const items = useSkillsStore((s) => s.items);
  const loading = useSkillsStore((s) => s.loading);
  const loaded = useSkillsStore((s) => s.loaded);
  const ensureLoaded = useSkillsStore((s) => s.ensureLoaded);
  const navigate = useNavigate();

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
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "70px",
        }}
      >
        <h2
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 600,
            fontSize: "25px",
            color: "var(--gv2-brand)",
            margin: 0,
          }}
        >
          Skill
        </h2>
        <button
          type="button"
          onClick={() => navigate("/settings/skills")}
          aria-label="Fechar painel de skills"
          className="rounded-full p-1 transition-colors hover:bg-[var(--gv2-active-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
          style={{ color: "var(--gv2-text-secondary)" }}
        >
          <PanelLeftClose
            style={{ width: "18px", height: "18px" }}
            strokeWidth={1.5}
          />
        </button>
      </header>

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
  const navigate = useNavigate();
  const isActive = routeName === skill.name;
  const activeSkill = useSkillsStore((s) => s.activeSkill);
  const selectedFile = useSkillsStore((s) => s.selectedFile);
  const setSelectedFile = useSkillsStore((s) => s.setSelectedFile);

  function handleHeaderClick() {
    if (!isActive) {
      navigate(`/settings/skill/${encodeURIComponent(skill.name)}`);
    } else {
      setSelectedFile({ kind: "skill" });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleHeaderClick}
        className="flex w-full items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
        style={{
          gap: "10px",
          padding: "15px 25px",
          borderRadius: "var(--gv2-radius-sm)",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
          background: isActive ? "var(--gv2-active-bg)" : "transparent",
          color: isActive
            ? "var(--gv2-active-text)"
            : "var(--gv2-text-secondary)",
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
        <span className="flex-1 truncate text-left font-mono">
          {skill.name}
        </span>
      </button>
      {isActive ? (
        <SkillSubItems
          references={activeSkill?.references ?? []}
          selected={selectedFile}
          onSelect={setSelectedFile}
        />
      ) : null}
    </>
  );
}

interface SkillSubItemsProps {
  references: string[];
  selected: SelectedSkillFile;
  onSelect: (file: SelectedSkillFile) => void;
}

function SkillSubItems({ references, selected, onSelect }: SkillSubItemsProps) {
  return (
    <ul style={{ marginTop: "5px" }}>
      <SubItem
        label="Skill.md"
        active={selected.kind === "skill"}
        onClick={() => onSelect({ kind: "skill" })}
      />
      {references.map((filename) => (
        <SubItem
          key={filename}
          label={prettyReferenceLabel(filename)}
          active={selected.kind === "reference" && selected.filename === filename}
          onClick={() => onSelect({ kind: "reference", filename })}
        />
      ))}
    </ul>
  );
}

function SubItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
        style={{
          paddingLeft: "39px",
          paddingTop: "5px",
          paddingBottom: "5px",
          paddingRight: "25px",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
          color: "var(--gv2-active-text)",
          fontWeight: active ? 600 : 400,
          textAlign: "left",
        }}
      >
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

/** Filename → label legível. Drop extensão e troca `-`/`_` por espaço.
 *  "padrao-de-legendas.md" → "Padrao de legendas". Mantém capitalização
 *  amigável só na primeira letra; o resto pode ser misturado e tudo bem. */
function prettyReferenceLabel(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  const spaced = stem.replace(/[-_]+/g, " ").trim();
  if (!spaced) return filename;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
