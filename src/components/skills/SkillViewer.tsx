import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTauriCommand } from "@/hooks/useTauriCommand";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { readSkill } from "@/lib/tauri-bridge";

export function SkillViewer() {
  const { name = "" } = useParams<{ name: string }>();
  const { data, loading, error, execute } = useTauriCommand(readSkill);
  const { toast } = useToast();

  useEffect(() => {
    if (name) {
      execute({ name });
    }
  }, [execute, name]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Falha ao carregar skill",
        description: error,
        variant: "destructive",
      });
    }
  }, [error, toast]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/skills">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-lg font-semibold">{name}</h2>
          <p className="text-xs text-[var(--text-2)]">
            {loading ? "Carregando..." : error ? "Erro ao carregar" : "Visualizando skill"}
          </p>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {loading && !data ? null : data ? (
            <article className="rounded-xl border border-border bg-card p-6 text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {data}
              </ReactMarkdown>
            </article>
          ) : !error ? (
            <EmptyState />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-16 text-center text-sm text-[var(--text-2)]">
      Skill vazia ou não encontrada.
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
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-[var(--border-sub)] px-2 py-1">{children}</td>
  ),
  hr: () => <hr className="my-4 border-[var(--border-sub)]" />,
};
