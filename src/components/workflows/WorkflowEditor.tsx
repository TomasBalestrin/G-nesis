import { useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  deleteWorkflow,
  readWorkflow,
  saveWorkflow,
} from "@/lib/tauri-bridge";
import { useWorkflowsStore } from "@/stores/workflowsStore";

// Default scaffold for `/workflows/new`. Parses cleanly under
// orchestrator::workflow_parser so the user can hit Save and iterate.
const TEMPLATE = `---
name: meu-workflow
description: Encadeia skills em sequência
version: "1.0"
author: Bethel
triggers:
  - palavra-chave
---

# Pré-requisitos
- skill-a instalada

## Etapa 1
Skill: skill-a
Input: {{repo_path}}
Output: resultado
Condição: sempre

## Etapa 2
Skill: skill-b
Input: {{etapa_1.resultado}}
Output: relatorio
Condição: sucesso
`;

/**
 * Unified create/edit surface for workflows. Routes:
 *  - /workflows/new      → empty name field + TEMPLATE in the editor
 *  - /workflows/:name    → name pre-filled (locked) + content via readWorkflow
 *
 * Save validates server-side (workflow_parser) and refreshes the store.
 * Editor textarea + preview split — workflows ainda não migraram
 * pro flow agent-driven que skills usam.
 */
export function WorkflowEditor() {
  const params = useParams<{ name?: string }>();
  const routeName = params.name?.trim() ?? "";
  const isEdit = routeName.length > 0;

  const [name, setName] = useState(routeName);
  const [content, setContent] = useState(isEdit ? "" : TEMPLATE);
  const [preview, setPreview] = useState(isEdit ? "" : TEMPLATE);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const navigate = useNavigate();
  const { toast } = useToast();
  const refreshWorkflows = useWorkflowsStore((s) => s.refresh);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    setLoading(true);
    setName(routeName);
    readWorkflow({ name: routeName })
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setPreview(text);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: "Falha ao carregar workflow",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, routeName, toast]);

  // 300ms debounce keeps the markdown renderer off the hot keystroke path.
  useEffect(() => {
    const timer = setTimeout(() => setPreview(content), 300);
    return () => clearTimeout(timer);
  }, [content]);

  async function handleDelete() {
    if (!isEdit) return;
    setDeleting(true);
    try {
      await deleteWorkflow({ name: routeName });
      toast({ title: `Workflow ${routeName} deletado` });
      await refreshWorkflows();
      navigate("/workflows");
    } catch (err) {
      toast({
        title: "Falha ao deletar workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({
        title: "Informe o nome do workflow",
        description: "O nome vira o nome do arquivo .md no workflows_dir.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await saveWorkflow({ name: trimmed, content });
      toast({
        title: "Workflow salvo",
        description: `${trimmed}.md gravado.`,
      });
      refreshWorkflows();
      if (!isEdit) {
        navigate(`/workflows/${encodeURIComponent(trimmed)}`);
      }
    } catch (err) {
      toast({
        title: "Falha ao salvar workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0 flex-1">
          {isEdit ? (
            <>
              <h2 className="truncate font-mono text-lg font-semibold">
                {routeName}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {loading
                  ? "Carregando..."
                  : `Editando workflows/${routeName}.md`}
              </p>
            </>
          ) : (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nome-do-workflow"
              aria-label="Nome do workflow"
              className="max-w-xs font-mono"
            />
          )}
        </div>
        {isEdit ? (
          <Button
            variant="outline"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || loading || deleting}
            aria-label={`Deletar workflow ${routeName}`}
          >
            <Trash2 className="h-4 w-4" />
            Deletar
          </Button>
        ) : null}
        <Button
          onClick={handleSave}
          disabled={saving || loading || !name.trim()}
        >
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </header>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deletar workflow {routeName}?</DialogTitle>
            <DialogDescription>
              O arquivo <span className="font-mono">{routeName}.md</span> será
              removido do <span className="font-mono">workflows_dir</span>.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deletando..." : "Deletar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className={cn(
          "grid flex-1 overflow-hidden",
          "grid-cols-2 max-[800px]:grid-cols-1 max-[800px]:grid-rows-2",
        )}
      >
        <section
          className="flex flex-col border-r border-border max-[800px]:border-b max-[800px]:border-r-0"
          aria-label="Editor"
        >
          <SectionLabel>Editor</SectionLabel>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            disabled={loading}
            aria-label="Conteúdo do workflow"
            placeholder={loading ? "Carregando..." : ""}
            className="flex-1 resize-none bg-[var(--code-bg)] p-4 font-mono text-xs leading-relaxed text-[var(--code-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none disabled:opacity-60"
          />
        </section>

        <section className="flex flex-col" aria-label="Preview">
          <SectionLabel>Preview</SectionLabel>
          <ScrollArea className="flex-1">
            <article className="p-6 text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {preview}
              </ReactMarkdown>
            </article>
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--border-sub)] bg-[var(--bg-tertiary)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
      {children}
    </div>
  );
}

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-4 text-2xl font-bold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-xl font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-lg font-semibold">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-2 whitespace-pre-wrap first:mt-0">{children}</p>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg bg-[var(--code-bg)] p-3 font-mono text-xs text-[var(--code-tx)]">
      {children}
    </pre>
  ),
  code: ({ className, children }) => (
    <code
      className={cn(
        "rounded bg-[var(--code-bg)] px-1 py-0.5 font-mono text-xs text-[var(--code-tx)]",
        className,
      )}
    >
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[var(--border-str)] pl-3 text-[var(--text-secondary)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-[var(--border-sub)]" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
};
