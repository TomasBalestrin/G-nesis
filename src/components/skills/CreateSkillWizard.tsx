import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  createSkill,
  deleteSkill,
  getAppStateValue,
  getSkill,
  listSkills,
  saveSkillFile,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useSkillsStore } from "@/stores/skillsStore";
import { CreateSkillStep2 } from "@/components/skills/CreateSkillStep2";
import { CreateSkillStep3 } from "@/components/skills/CreateSkillStep3";
import type { SkillSubFile } from "@/components/skills/CreateSkillStep3";
import { buildSkillMd, renderStep2Template } from "@/components/skills/wizardHelpers";

type Step = 1 | 2 | 3;

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_VERSION = "1.0";

/**
 * Wizard 3-etapas — atende criação (`/skills/new`) e edição
 * (`/skills/:name/edit`). Em modo edição, a etapa 1 (info básica)
 * é pulada e o SKILL.md/refs/assets são hidratados via getSkill,
 * abrindo direto na etapa 2.
 *
 * Fluxo de criação:
 *   - Etapa 1: nome (slug com checagem real-time) + descrição +
 *     versão (1.0) + autor (default app_state.user_name).
 *   - Etapa 2: editor markdown com toolbar + preview + auto-save.
 *   - Etapa 3 (opcional): references + assets + estrutura final.
 *
 * Fluxo de edição:
 *   - Hidrata SKILL.md + listas de refs/assets.
 *   - Abre na etapa 2; "Voltar" volta pro SkillDetailView (não pra
 *     etapa 1, já que nome/descrição não podem mudar aqui).
 */
export function CreateSkillWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const refreshSkills = useSkillsStore((s) => s.refresh);
  // Modo edição entra via rota /skills/:name/edit — `name` presente
  // no params indica que a skill já existe. Modo criação (/skills/new)
  // tem `name` vazio.
  const { name: editingName } = useParams<{ name?: string }>();
  const isEditing = Boolean(editingName);

  const [step, setStep] = useState<Step>(isEditing ? 2 : 1);

  // Etapa 1 state
  const [name, setName] = useState(editingName ?? "");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [author, setAuthor] = useState("");
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Etapa 2 state — conteúdo completo do SKILL.md (frontmatter + body).
  // Owned aqui pra sobreviver às transições back/forward do wizard.
  const [skillMdContent, setSkillMdContent] = useState("");
  const [hydrating, setHydrating] = useState(isEditing);

  // Etapa 3 state — references e assets já gravados em disco. As
  // listas servem só pra renderizar a estrutura final + permitir
  // remoção; o disco continua source-of-truth.
  const [referencesList, setReferencesList] = useState<SkillSubFile[]>([]);
  const [assetsList, setAssetsList] = useState<SkillSubFile[]>([]);

  // Hidrata o set de nomes existentes pra checagem real-time + autor
  // default. Falhas silenciosas — a validação final acontece no
  // backend via createSkill.
  useEffect(() => {
    if (isEditing) return;
    void listSkills()
      .then((skills) => setExistingNames(new Set(skills.map((s) => s.name))))
      .catch(() => setExistingNames(new Set()));
    void getAppStateValue({ key: "user_name" })
      .then((v) => {
        if (v) setAuthor(v);
      })
      .catch(() => {});
  }, [isEditing]);

  // Modo edição: hidrata SKILL.md + listas de refs/assets do disco
  // pra que Step 2 abra com conteúdo existente, Step 3 mostre o que
  // já está em disco. Fallback amigável em caso de skill ausente.
  useEffect(() => {
    if (!isEditing || !editingName) return;
    let cancelled = false;
    (async () => {
      try {
        const bundle = await getSkill({ name: editingName });
        if (cancelled) return;
        setSkillMdContent(bundle.skill_md);
        setReferencesList(
          bundle.references.map((filename) => ({ filename, size: 0 })),
        );
        setAssetsList(
          bundle.assets.map((filename) => ({ filename, size: 0 })),
        );
      } catch (err) {
        if (cancelled) return;
        toast({
          title: "Falha ao carregar skill pra edição",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        navigate(`/skills/${encodeURIComponent(editingName)}`);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, editingName, navigate, toast]);

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

  const backTarget = isEditing
    ? `/skills/${encodeURIComponent(name)}`
    : "/";
  const closeToDetail = () => {
    void refreshSkills();
    navigate(`/skills/${encodeURIComponent(name)}`);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to={backTarget}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">
            {isEditing ? `Editar ${name}` : "Nova skill"}
          </h2>
          <StepIndicator step={step} />
        </div>
      </header>

      {hydrating ? (
        <div className="flex flex-1 items-center justify-center text-xs text-[var(--text-3)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
          Carregando...
        </div>
      ) : null}

      {!hydrating && step === 2 ? (
        <CreateSkillStep2
          skillName={name}
          content={skillMdContent}
          onContentChange={setSkillMdContent}
          onBack={isEditing ? closeToDetail : () => setStep(1)}
          onNext={() => setStep(3)}
          onSaveAndClose={closeToDetail}
        />
      ) : null}
      {!hydrating && step === 3 ? (
        <CreateSkillStep3
          skillName={name}
          references={referencesList}
          assets={assetsList}
          onReferencesChange={setReferencesList}
          onAssetsChange={setAssetsList}
          onBack={() => setStep(2)}
          onFinish={() => {
            toast({
              title: isEditing
                ? `Skill ${name} atualizada`
                : `Skill ${name} pronta`,
            });
            closeToDetail();
          }}
        />
      ) : null}
      {step === 1 ? (
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-xl p-6">
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
          </div>
        </div>
      ) : null}
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

