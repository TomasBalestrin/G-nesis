import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  createSkill,
  deleteSkill,
  getAppStateValue,
  listSkills,
  saveSkillFile,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useSkillsStore } from "@/stores/skillsStore";
import { CreateSkillStep2 } from "@/components/skills/CreateSkillStep2";
import { buildSkillMd, renderStep2Template } from "@/components/skills/wizardHelpers";

type Step = 1 | 2 | 3;

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_VERSION = "1.0";

/**
 * Wizard 3-etapas pra criar um package v2 do zero. Esta task (C1)
 * implementa apenas a Etapa 1 — info básica (nome + descrição +
 * versão + autor). Etapas 2 e 3 ficam como placeholder e serão
 * preenchidas em C2/C3.
 *
 * Etapa 1 — flow:
 *   1. Validação real-time do slug (regex + listSkills uniqueness).
 *   2. Versão default "1.0", autor default vem de app_state.user_name
 *      (mesma fonte do greeting do chat).
 *   3. Próximo → createSkill({name}) cria pasta + template, depois
 *      saveSkillFile({name, path: "SKILL.md", content}) sobrescreve
 *      o template com a frontmatter customizada do usuário. Avança
 *      pra etapa 2.
 *   4. Cancelar → navega pra `/`.
 *
 * Substitui SkillEditor como entry-point de NOVA skill. Edição de
 * skills v1 legacy continua via /skills/:name/edit (SkillEditor) até
 * v2 ganhar editor próprio.
 */
export function CreateSkillWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const [step, setStep] = useState<Step>(1);

  // Etapa 1 state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [author, setAuthor] = useState("");
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Etapa 2 state — conteúdo completo do SKILL.md (frontmatter + body).
  // Owned aqui pra sobreviver às transições back/forward do wizard.
  const [skillMdContent, setSkillMdContent] = useState("");

  // Hidrata o set de nomes existentes pra checagem real-time + autor
  // default. Falhas silenciosas — a validação final acontece no
  // backend via createSkill.
  useEffect(() => {
    void listSkills()
      .then((skills) => setExistingNames(new Set(skills.map((s) => s.name))))
      .catch(() => setExistingNames(new Set()));
    void getAppStateValue({ key: "user_name" })
      .then((v) => {
        if (v) setAuthor(v);
      })
      .catch(() => {});
  }, []);

  function handleNameChange(raw: string) {
    const slug = raw.toLowerCase().replace(/\s+/g, "-");
    setName(slug);
  }

  const nameStatus: "empty" | "invalid" | "duplicate" | "ok" = useMemo(() => {
    if (!name) return "empty";
    if (!SLUG_REGEX.test(name)) return "invalid";
    if (existingNames.has(name)) return "duplicate";
    return "ok";
  }, [name, existingNames]);

  const canAdvance =
    nameStatus === "ok" &&
    description.trim().length > 0 &&
    version.trim().length > 0 &&
    author.trim().length > 0 &&
    !submitting;

  async function handleNext() {
    if (!canAdvance) return;
    const trimmedName = name;
    const trimmedDescription = description.trim();
    const trimmedVersion = version.trim();
    const trimmedAuthor = author.trim();

    setSubmitting(true);
    let created = false;
    try {
      await createSkill({ name: trimmedName });
      created = true;
      // Body inicial = template sugerido (## O que faz / ## Regras /
      // ## Passos), pré-preenchido com a descrição da etapa 1.
      // Etapa 2 abre direto com isto carregado no editor; auto-save
      // sincroniza edições subsequentes.
      const initialBody = renderStep2Template(
        trimmedName,
        trimmedDescription,
      );
      const skillMd = buildSkillMd(
        {
          name: trimmedName,
          description: trimmedDescription,
          version: trimmedVersion,
          author: trimmedAuthor,
        },
        initialBody,
      );
      await saveSkillFile({
        name: trimmedName,
        path: "SKILL.md",
        content: skillMd,
      });
      await refreshSkills();
      setSkillMdContent(skillMd);
      toast({ title: `Skill ${trimmedName} criada` });
      setStep(2);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Rollback: se o create passou mas a sobrescrita do SKILL.md
      // falhou, a pasta fica com o template default. Apaga pra que
      // o usuário possa re-tentar com o mesmo nome sem colidir.
      if (created) {
        try {
          await deleteSkill({ name: trimmedName });
          await refreshSkills();
        } catch {
          // best-effort — se falhar, o usuário verá o erro original
          // e pode apagar manualmente via Settings → Skills.
        }
      }
      toast({
        title: "Falha ao criar skill",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Nova skill</h2>
          <StepIndicator step={step} />
        </div>
      </header>

      {step === 2 ? (
        <CreateSkillStep2
          skillName={name}
          content={skillMdContent}
          onContentChange={setSkillMdContent}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
          onSaveAndClose={() =>
            navigate(`/skills/${encodeURIComponent(name)}`)
          }
        />
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-xl p-6">
            {step === 1 ? (
              <Step1
                name={name}
                nameStatus={nameStatus}
                description={description}
                version={version}
                author={author}
                submitting={submitting}
                canAdvance={canAdvance}
                onNameChange={handleNameChange}
                onDescriptionChange={setDescription}
                onVersionChange={setVersion}
                onAuthorChange={setAuthor}
                onCancel={() => navigate("/")}
                onNext={handleNext}
              />
            ) : null}
            {step === 3 ? (
              <StepPlaceholder
                step={3}
                skillName={name}
                onBack={() => setStep(2)}
                onCancel={() =>
                  navigate(`/skills/${encodeURIComponent(name)}`)
                }
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

interface Step1Props {
  name: string;
  nameStatus: "empty" | "invalid" | "duplicate" | "ok";
  description: string;
  version: string;
  author: string;
  submitting: boolean;
  canAdvance: boolean;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onVersionChange: (v: string) => void;
  onAuthorChange: (v: string) => void;
  onCancel: () => void;
  onNext: () => void;
}

function Step1({
  name,
  nameStatus,
  description,
  version,
  author,
  submitting,
  canAdvance,
  onNameChange,
  onDescriptionChange,
  onVersionChange,
  onAuthorChange,
  onCancel,
  onNext,
}: Step1Props) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
      className="space-y-6"
      aria-label="Etapa 1 — info básica"
    >
      <div className="space-y-2">
        <label htmlFor="skill-name" className="text-sm font-medium">
          Nome
        </label>
        <Input
          id="skill-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="minha-skill"
          className="font-mono"
          autoFocus
          disabled={submitting}
        />
        <NameStatusHint status={nameStatus} />
      </div>

      <div className="space-y-2">
        <label htmlFor="skill-description" className="text-sm font-medium">
          Descrição curta
        </label>
        <Input
          id="skill-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="O que essa skill faz em 1 linha"
          disabled={submitting}
          maxLength={160}
        />
        <p className="text-[11px] text-[var(--text-3)]">
          Aparece na lista de skills e no autocomplete do `/`.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="skill-version" className="text-sm font-medium">
            Versão
          </label>
          <Input
            id="skill-version"
            value={version}
            onChange={(e) => onVersionChange(e.target.value)}
            placeholder={DEFAULT_VERSION}
            className="font-mono"
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="skill-author" className="text-sm font-medium">
            Autor
          </label>
          <Input
            id="skill-author"
            value={author}
            onChange={(e) => onAuthorChange(e.target.value)}
            placeholder="Seu nome"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={!canAdvance}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          )}
          {submitting ? "Criando..." : "Próximo"}
        </Button>
      </div>
    </form>
  );
}

function NameStatusHint({
  status,
}: {
  status: "empty" | "invalid" | "duplicate" | "ok";
}) {
  if (status === "empty") {
    return (
      <p className="text-[11px] text-[var(--text-3)]">
        Slug pra invocar com `/`. Lowercase, dígitos e hífens.
      </p>
    );
  }
  if (status === "invalid") {
    return (
      <p className="text-[11px] text-[var(--destructive)]">
        Use só letras minúsculas, dígitos e hífens (começando por
        letra/dígito).
      </p>
    );
  }
  if (status === "duplicate") {
    return (
      <p className="text-[11px] text-[var(--destructive)]">
        Já existe uma skill com esse nome.
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)]">
      <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
      Disponível
    </p>
  );
}

interface StepPlaceholderProps {
  step: 3;
  skillName: string;
  onBack: () => void;
  onCancel: () => void;
}

function StepPlaceholder({
  step,
  skillName,
  onBack,
  onCancel,
}: StepPlaceholderProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-6 py-8 text-sm">
        <p className="font-medium">Etapa {step} — em construção</p>
        <p className="mt-2 text-[var(--text-2)]">
          A skill <span className="font-mono">{skillName}</span> já foi criada
          em disco. As próximas etapas (instruções e arquivos auxiliares)
          chegam em C{step}.
        </p>
        <p className="mt-2 text-[var(--text-3)]">
          Por ora, abra a skill na lista pra visualizar o package.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Voltar
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Concluir
        </Button>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  return (
    <span className="flex items-center gap-2 text-xs text-[var(--text-3)]">
      <span
        className={cn(
          "h-1.5 w-6 rounded-full transition-colors",
          step >= 1 ? "bg-[var(--accent)]" : "bg-[var(--bg-muted)]",
        )}
      />
      <span
        className={cn(
          "h-1.5 w-6 rounded-full transition-colors",
          step >= 2 ? "bg-[var(--accent)]" : "bg-[var(--bg-muted)]",
        )}
      />
      <span
        className={cn(
          "h-1.5 w-6 rounded-full transition-colors",
          step >= 3 ? "bg-[var(--accent)]" : "bg-[var(--bg-muted)]",
        )}
      />
      <span>Etapa {step} de 3</span>
    </span>
  );
}

