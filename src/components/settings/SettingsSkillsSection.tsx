import { useEffect, useState } from "react";
import { FileCode, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImportSkillZone } from "@/components/skills/ImportSkillZone";
import { useToast } from "@/hooks/useToast";
import { deleteSkill, getConfig } from "@/lib/tauri-bridge";
import { useSkillsStore } from "@/stores/skillsStore";
import type { SkillMeta } from "@/types/skill";

/**
 * Settings → /settings/skills. Catálogo de skills com path do
 * `skills_dir` no header e botão de criar/deletar. Click no card
 * leva pro viewer (SkillRouteDispatch decide v1 vs v2).
 */
export function SettingsSkillsSection() {
  const items = useSkillsStore((s) => s.items);
  const loaded = useSkillsStore((s) => s.loaded);
  const loading = useSkillsStore((s) => s.loading);
  const ensureLoaded = useSkillsStore((s) => s.ensureLoaded);
  const refresh = useSkillsStore((s) => s.refresh);
  const [skillsDir, setSkillsDir] = useState<string>("");

  useEffect(() => {
    void ensureLoaded();
    void getConfig().then((cfg) => setSkillsDir(cfg.skills_dir));
  }, [ensureLoaded]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">Skills</h2>
          <p className="truncate text-sm text-[var(--text-2)]">
            <span className="text-[var(--text-3)]">skills_dir:</span>{" "}
            <span className="font-mono">{skillsDir || "—"}</span>
          </p>
        </div>
        <Button asChild>
          <Link to="/skills/new">
            <Plus className="h-4 w-4" />
            Nova skill
          </Link>
        </Button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          <ImportSkillZone onImported={refresh} />
          <div className="space-y-3">
            {!loaded && loading ? (
              <p className="text-sm text-[var(--text-2)]">Carregando...</p>
            ) : items.length === 0 ? (
              <p className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-8 text-center text-sm text-[var(--text-2)]">
                Nenhuma skill ainda.
              </p>
            ) : (
              items.map((skill) => (
                <SkillCard key={skill.name} skill={skill} onDeleted={refresh} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SkillCardProps {
  skill: SkillMeta;
  onDeleted: () => Promise<void>;
}

function SkillCard({ skill, onDeleted }: SkillCardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const description = skill.description.trim();

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await deleteSkill({ name: skill.name });
      toast({ title: `Skill ${skill.name} deletada` });
      await onDeleted();
    } catch (err) {
      toast({
        title: "Falha ao deletar skill",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() =>
        navigate(`/settings/skill/${encodeURIComponent(skill.name)}`)
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/settings/skill/${encodeURIComponent(skill.name)}`);
        }
      }}
      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
    >
      <FileCode className="mt-1 h-4 w-4 shrink-0 text-[var(--text-3)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm font-medium">
          {skill.name}
        </div>
        {description ? (
          <div className="mt-0.5 truncate text-xs text-[var(--text-2)]">
            {description}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Deletar ${skill.name}`}
        onClick={(e) => {
          e.stopPropagation();
          setConfirmOpen(true);
        }}
        className="shrink-0 rounded p-1.5 text-[var(--text-3)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Deletar skill?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{skill.name}</span> será removida do{" "}
              <span className="font-mono">skills_dir</span>. Execuções em
              andamento bloqueiam a deleção.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deletando..." : "Deletar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
