import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type SkillFileViewerMode = "visual" | "code";

interface MarkdownPreviewProps {
  content: string;
  /** Override do container externo. Default `prose`-like com max-width
   *  e padding pra leitura confortável (≤ 15px conforme DESIGN.md). */
  className?: string;
}

/**
 * Render bonito de markdown — inclui GFM (tabelas, checklists,
 * strikethrough). Usado pelo preview do SkillDetailView e pelo
 * split-view do CreateSkillStep2. Estilo segue o Elite Premium:
 * tipografia hierárquica, gold só nos links/accents, code blocks
 * com background do design system. Sem syntax highlighting (overkill
 * pra autoria de skills; pode entrar depois se necessário).
 */
export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <article
      className={cn(
        "mx-auto max-w-3xl px-6 py-6 text-sm leading-relaxed text-[var(--text)]",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </article>
  );
}

interface CodeViewProps {
  content: string;
  /** Quando true, aplica wrap em linhas longas (default true).
   *  Code de skill é prosa em prol da leitura, então wrap > scroll-x. */
  wrap?: boolean;
  className?: string;
}

/**
 * Display raw com numeração de linha e font monospace. Estilo
 * inspirado em editores de código: gutter cinza à esquerda, conteúdo
 * a direita. Não recebe input — pra editar use `<textarea>` direto.
 */
export function CodeView({
  content,
  wrap = true,
  className,
}: CodeViewProps) {
  const lines = useMemo(() => content.split("\n"), [content]);
  return (
    <pre
      className={cn(
        "flex font-mono text-xs leading-relaxed",
        className,
      )}
    >
      <code
        aria-hidden
        className="select-none border-r border-[var(--border-sub)] bg-[var(--bg-subtle)] px-3 py-4 text-right text-[var(--text-3)]"
      >
        {lines.map((_, idx) => (
          <div key={idx}>{idx + 1}</div>
        ))}
      </code>
      <code className="flex-1 px-4 py-4 text-[var(--code-text)]">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
            )}
          >
            {line || " "}
          </div>
        ))}
      </code>
    </pre>
  );
}

interface SkillFileViewerProps {
  content: string;
  mode: SkillFileViewerMode;
  /** Quando true, força sempre o `CodeView` mesmo em modo visual.
   *  Útil pra arquivos não-markdown (HTML, JSON) que não fazem sentido
   *  renderizar como markdown — caller decide. */
  forceCode?: boolean;
  className?: string;
}

/**
 * Wrapper que escolhe entre `MarkdownPreview` (visual) e `CodeView`
 * (raw). Embrulha tudo num `ScrollArea` pra que o caller só precise
 * dar a altura do container — interno scrolla sozinho.
 */
export function SkillFileViewer({
  content,
  mode,
  forceCode,
  className,
}: SkillFileViewerProps) {
  const showVisual = mode === "visual" && !forceCode;
  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)}>
      {showVisual ? (
        <MarkdownPreview content={content} />
      ) : (
        <CodeView content={content} />
      )}
    </ScrollArea>
  );
}

// ── markdown components ─────────────────────────────────────────────────────

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 border-b border-[var(--border-sub)] pb-2 text-2xl font-bold tracking-tight text-[var(--text)] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-6 text-xl font-semibold tracking-tight text-[var(--text)]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-lg font-semibold text-[var(--text)]">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-4 text-base font-semibold text-[var(--text)]">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-3 whitespace-pre-wrap leading-7 first:mt-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>
  ),
  li: ({ children, className }) => (
    // remark-gfm marca task-list-item; resetamos `list-style` via class
    // pro checkbox aparecer no lugar do bullet.
    <li
      className={cn(
        "leading-7",
        className?.includes("task-list-item") && "list-none",
      )}
    >
      {children}
    </li>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg border border-[var(--border-sub)] bg-[var(--code-bg)] p-3 font-mono text-xs leading-relaxed text-[var(--code-text)]">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    // Inline code — block code já passa por `pre` que provê o fundo.
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded bg-[var(--bg-muted)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--text)]">
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-[var(--accent)] bg-[var(--accent-soft)]/30 py-1 pl-4 pr-2 italic text-[var(--text-2)]">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-[var(--border-sub)]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[var(--bg-subtle)] text-[var(--text-2)]">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-[var(--border-sub)] last:border-0">
      {children}
    </tr>
  ),
  th: ({ children, style }) => (
    <th
      className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider"
      style={style}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="px-3 py-2 align-top text-sm" style={style}>
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-[var(--border-sub)]" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--accent)] underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),
  // remark-gfm renders [x] / [ ] como <input type="checkbox" disabled>.
  // Override pra aplicar styling consistente com o design system.
  input: ({ type, checked, disabled }) => {
    if (type !== "checkbox") return null;
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        readOnly
        className="mr-2 h-3.5 w-3.5 align-middle accent-[var(--accent)]"
      />
    );
  },
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--text)]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => (
    <del className="text-[var(--text-3)]">{children}</del>
  ),
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      className="my-3 max-w-full rounded border border-[var(--border-sub)]"
    />
  ),
};
