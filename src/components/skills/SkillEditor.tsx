import { useEffect, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { saveSkill } from "@/lib/tauri-bridge";

// Template com frontmatter + estrutura mínima válida, parseável pelo
// orchestrator::skill_parser (D1): frontmatter com name/description/version/
// author, uma seção Tools, um step com tool obrigatório.
const TEMPLATE = `---
name: minha-skill
description: Descrição curta da skill
version: 1.0.0
author: Bethel
---

# Tools
- bash

# Inputs
- input_1

# Steps

## step_1
tool: bash
command: echo "Olá, {{input_1}}"
validate: exit_code == 0

# Outputs
- result

# Config
timeout: 300
`;

export function SkillEditor() {
  const [name, setName] = useState("");
  const [content, setContent] = useState(TEMPLATE);
  const [preview, setPreview] = useState(TEMPLATE);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Preview renderiza com 300ms de debounce pra não recompilar markdown a
  // cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => setPreview(content), 300);
    return () => clearTimeout(timer);
  }, [content]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({
        title: "Informe o nome da skill",
        description: "O nome vira o nome do arquivo .md no skills_dir.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // O backend (D3) chama skill_parser::parse_skill antes de gravar, então
      // um parse inválido vira erro aqui sem criar arquivo quebrado.
      await saveSkill({ name: trimmed, content });
      toast({ title: "Skill salva", description: `${trimmed}.md gravada.` });
      navigate(`/skills/${encodeURIComponent(trimmed)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Falha ao salvar skill",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/skills">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="nome-da-skill"
          aria-label="Nome da skill"
          className="max-w-xs font-mono"
        />
        <div className="flex-1" />
        <Button onClick={handleSave} disabled={saving || !name.trim()}>
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </header>

      <div
        className={cn(
          "grid flex-1 overflow-hidden",
          "grid-cols-2 max-[800px]:grid-cols-1 max-[800px]:grid-rows-2",
        )}
      >
        <section
          className="flex flex-col border-r border-border max-[800px]:border-r-0 max-[800px]:border-b"
          aria-label="Editor"
        >
          <div className="border-b border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Editor
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            aria-label="Conteúdo da skill"
            className="flex-1 resize-none bg-background p-4 font-mono text-xs leading-relaxed text-foreground placeholder:text-[var(--text-dis)] focus:outline-none"
          />
        </section>

        <section className="flex flex-col" aria-label="Preview">
          <div className="border-b border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Preview
          </div>
          <ScrollArea className="flex-1">
            <article className="p-6 text-sm leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
                {preview}
              </ReactMarkdown>
            </article>
          </ScrollArea>
        </section>
      </div>
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
    <pre className="my-3 overflow-x-auto rounded-lg bg-[var(--code-bg)] p-3 text-xs text-[var(--code-tx)] font-mono">
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
    <blockquote className="my-2 border-l-2 border-[var(--border-str)] pl-3 text-[var(--text-2)]">
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
