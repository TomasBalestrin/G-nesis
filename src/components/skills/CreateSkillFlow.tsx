import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkillArchitectChat } from "@/components/skills/SkillArchitectChat";
import { listSkills } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

type Screen = "name" | "agent";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Fluxo agent-driven de criação/edição de skill v2. Telas:
 *
 *   1. Nome (só create) — campo único centralizado, slug automático,
 *      checagem real-time vs catálogo. Em modo edit (rota
 *      /skills/:name/edit) essa tela é pulada.
 *   2. Agent — chat com Skill Architect que conduz a autoria via
 *      {"skill_write": {...}} (B3) e materializa via
 *      save_generated_skill (B4, create) ou saveSkillFile por
 *      arquivo (E1, edit) quando o usuário aprova.
 *
 * O componente é stateless do ponto de vista da rota — owner externo
 * (route handler ou modal parent) decide quando montá-lo. State da
 * skill em construção (nome + arquivos acumulados) vive aqui.
 */
export function CreateSkillFlow() {
  const navigate = useNavigate();
  // Em /skills/:name/edit o useParams traz o name → modo "edit"
  // pula direto pra Tela 2 com a skill carregada. Em /skills/new
  // o name é vazio → começa pela Tela 1.
  const { name: editingName } = useParams<{ name?: string }>();
  const isEditing = Boolean(editingName);

  const [screen, setScreen] = useState<Screen>(isEditing ? "agent" : "name");
  const [name, setName] = useState(editingName ?? "");

  function handleAdvanceFromName(finalName: string) {
    setName(finalName);
    setScreen("agent");
  }

  if (screen === "name") {
    return <NameScreen initialName={name} onContinue={handleAdvanceFromName} />;
  }
  return (
    <SkillArchitectChat
      name={name}
      mode={isEditing ? "edit" : "create"}
      onExit={() => {
        // Após salvar (ou descartar) o flow termina e voltamos pro
        // detail da skill, OU pra home se o user desistiu antes do
        // save (apenas no fluxo de criação).
        if (name) {
          navigate(`/skills/${encodeURIComponent(name)}`);
        } else {
          navigate("/");
        }
      }}
    />
  );
}

interface NameScreenProps {
  initialName: string;
  onContinue: (name: string) => void;
}

/**
 * Tela 1 — só campo + botão. Centralizado vertical/horizontal pra
 * que o usuário não tenha distração. `existingNames` carrega 1x no
 * mount; checagem é local (sem debounce de IPC).
 */
function NameScreen({ initialName, onContinue }: NameScreenProps) {
  const [name, setName] = useState(initialName);
  const [existingNames, setExistingNames] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listSkills()
      .then((skills) => {
        if (cancelled) return;
        setExistingNames(new Set(skills.map((s) => s.name)));
      })
      .catch(() => {
        // Se a lista falhar, deixa o backend ser a barreira final
        // (createSkill / save_generated_skill rejeita duplicata).
        if (!cancelled) setExistingNames(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleNameChange(raw: string) {
    // Slug: lowercase + spaces → hífens. Real-time pra que o user
    // veja imediatamente como o handle vai sair.
    const slug = raw.toLowerCase().replace(/\s+/g, "-");
    setName(slug);
  }

  const status = useMemo<NameStatus>(() => {
    if (!name) return "empty";
    if (!SLUG_REGEX.test(name)) return "invalid";
    if (existingNames === null) return "checking";
    if (existingNames.has(name)) return "duplicate";
    return "available";
  }, [name, existingNames]);

  const canAdvance = status === "available";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canAdvance) return;
    onContinue(name);
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6"
        aria-label="Nome da nova skill"
      >
        <header className="text-center">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-[var(--text)]">
            Nova skill
          </h1>
          <p className="mt-2 text-sm text-[var(--text-2)]">
            Como você quer chamar essa skill?
          </p>
        </header>

        <div className="space-y-2">
          <Input
            id="skill-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="legendar-videos"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className={cn(
              "font-mono text-base",
              status === "duplicate" || status === "invalid"
                ? "border-[var(--destructive)] focus-visible:ring-[var(--destructive)]"
                : status === "available"
                  ? "border-[var(--accent)] focus-visible:ring-[var(--accent-ring)]"
                  : undefined,
            )}
          />
          <NameStatusLine status={status} />
        </div>

        <Button type="submit" disabled={!canAdvance} className="w-full">
          Continuar
          <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
        </Button>
      </form>
    </div>
  );
}

type NameStatus =
  | "empty"
  | "invalid"
  | "checking"
  | "duplicate"
  | "available";

function NameStatusLine({ status }: { status: NameStatus }) {
  switch (status) {
    case "empty":
      return (
        <p className="text-center text-[11px] text-[var(--text-3)]">
          Use slug: lowercase, dígitos e hífens. Espaços viram hífens
          automaticamente.
        </p>
      );
    case "invalid":
      return (
        <p className="inline-flex items-center gap-1 text-[11px] text-[var(--destructive)]">
          <X className="h-3 w-3" strokeWidth={1.5} />
          Comece com letra ou dígito; só lowercase, dígitos e hífens.
        </p>
      );
    case "checking":
      return (
        <p className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          Verificando disponibilidade...
        </p>
      );
    case "duplicate":
      return (
        <p className="inline-flex items-center gap-1 text-[11px] text-[var(--destructive)]">
          <X className="h-3 w-3" strokeWidth={1.5} />
          Já existe uma skill com esse nome.
        </p>
      );
    case "available":
      return (
        <p className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)]">
          <Check className="h-3 w-3" strokeWidth={1.5} />
          Disponível
        </p>
      );
  }
}

