import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bold,
  Code,
  Code2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Save,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/useToast";
import { saveSkillFile } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

type ViewMode = "split" | "visual" | "code";
const AUTOSAVE_MS = 2000;

interface CreateSkillStep2Props {
  skillName: string;
  /** Conteúdo completo do SKILL.md (frontmatter + body). Owned pelo
   *  parent CreateSkillWizard pra sobreviver às transições back/forward. */
  content: string;
  onContentChange: (next: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSaveAndClose: () => void;
}

/**
 * Etapa 2 do wizard — editor markdown + preview lado a lado com
 * toggle visual/código. Auto-save com debounce de 2s grava direto
 * no SKILL.md da pasta da skill (criada na etapa 1). Voltar /
 * Próximo / Salvar e Fechar fazem flush síncrono antes de
 * transicionar pra não perder edições <2s.
 *
 * Toolbar é minimalista: bold, italic, H1/H2/H3, listas, code block.
 * Cada botão envolve a seleção atual do textarea — convenção
 * markdown comum, sem WYSIWYG real (overkill pra autoria de skill).
 */
export function CreateSkillStep2({
  skillName,
  content,
  onContentChange,
  onBack,
  onNext,
  onSaveAndClose,
}: CreateSkillStep2Props) {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(new Date());
  const [transitioning, setTransitioning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSavedContentRef = useRef(content);

  // Auto-save debounce. lastSavedContentRef começa com o conteúdo
  // inicial (já gravado pelo Step1.handleNext) — evita save imediato
  // ao montar. Depois cada mudança real dispara um timer 2s.
  useEffect(() => {
    if (content === lastSavedContentRef.current) return;
    const timer = setTimeout(() => {
      void persistContent(content);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  async function persistContent(value: string): Promise<boolean> {
    if (value === lastSavedContentRef.current) return true;
    setSaving(true);
    try {
      await saveSkillFile({ name: skillName, path: "SKILL.md", content: value });
      lastSavedContentRef.current = value;
      setLastSavedAt(new Date());
      return true;
    } catch (err) {
      toast({
        title: "Falha ao salvar SKILL.md",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ── Toolbar handlers ─────────────────────────────────────────────────────────

  function wrapSelection(prefix: string, suffix = prefix) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = content.slice(0, start);
    const selection = content.slice(start, end);
    const after = content.slice(end);
    const next = before + prefix + selection + suffix + after;
    onContentChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selection.length,
      );
    });
  }

  function prefixLine(prefix: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const before = content.slice(0, start);
    const lineStart = before.lastIndexOf("\n") + 1;
    const next =
      content.slice(0, lineStart) + prefix + content.slice(lineStart);
    onContentChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }

  function insertCodeBlock() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selection = content.slice(start, end);
    const insert = selection
      ? `\n\`\`\`\n${selection}\n\`\`\`\n`
      : "\n```\n\n```\n";
    const next = content.slice(0, start) + insert + content.slice(end);
    onContentChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      // Posiciona cursor dentro do bloco vazio (após "\n```\n")
      const cursor = selection ? start + insert.length : start + 5;
      ta.setSelectionRange(cursor, cursor);
    });
  }

  // ── Transitions com flush síncrono ───────────────────────────────────────────

  async function handleBack() {
    setTransitioning(true);
    await persistContent(content);
    setTransitioning(false);
    onBack();
  }

  async function handleNext() {
    setTransitioning(true);
    const ok = await persistContent(content);
    setTransitioning(false);
    if (ok) onNext();
  }

  async function handleSaveAndClose() {
    setTransitioning(true);
    const ok = await persistContent(content);
    setTransitioning(false);
    if (ok) onSaveAndClose();
  }

  const showEditor = viewMode === "split" || viewMode === "code";
  const showPreview = viewMode === "split" || viewMode === "visual";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onBold={() => wrapSelection("**")}
        onItalic={() => wrapSelection("*")}
        onH1={() => prefixLine("# ")}
        onH2={() => prefixLine("## ")}
        onH3={() => prefixLine("### ")}
        onUl={() => prefixLine("- ")}
        onOl={() => prefixLine("1. ")}
        onCode={insertCodeBlock}
      />

      <div
        className={cn(
          "grid flex-1 overflow-hidden",
          showEditor && showPreview ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {showEditor ? (
          <section
            className={cn(
              "flex min-h-0 flex-col",
              showPreview && "border-r border-border",
            )}
            aria-label="Editor"
          >
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              spellCheck={false}
              aria-label="Conteúdo do SKILL.md"
              className="flex-1 resize-none bg-[var(--code-bg)] p-4 font-mono text-xs leading-relaxed text-[var(--code-text)] focus:outline-none"
            />
          </section>
        ) : null}
        {showPreview ? (
          <section className="flex min-h-0 flex-col" aria-label="Preview">
            <ScrollArea className="flex-1">
              <article className="p-6 text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {content}
                </ReactMarkdown>
              </article>
            </ScrollArea>
          </section>
        ) : null}
      </div>

      <Footer
        saving={saving}
        transitioning={transitioning}
        lastSavedAt={lastSavedAt}
        onBack={handleBack}
        onNext={handleNext}
        onSaveAndClose={handleSaveAndClose}
      />
    </div>
  );
}

interface ToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  onBold: () => void;
  onItalic: () => void;
  onH1: () => void;
  onH2: () => void;
  onH3: () => void;
  onUl: () => void;
  onOl: () => void;
  onCode: () => void;
}

function Toolbar({
  viewMode,
  onViewModeChange,
  onBold,
  onItalic,
  onH1,
  onH2,
  onH3,
  onUl,
  onOl,
  onCode,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[var(--bg-subtle)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <ToolbarBtn label="Bold (Ctrl+B)" onClick={onBold}>
          <Bold className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <ToolbarBtn label="Italic" onClick={onItalic}>
          <Italic className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <Separator />
        <ToolbarBtn label="H1" onClick={onH1}>
          <Heading1 className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <ToolbarBtn label="H2" onClick={onH2}>
          <Heading2 className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <ToolbarBtn label="H3" onClick={onH3}>
          <Heading3 className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <Separator />
        <ToolbarBtn label="Lista" onClick={onUl}>
          <List className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <ToolbarBtn label="Lista numerada" onClick={onOl}>
          <ListOrdered className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <ToolbarBtn label="Bloco de código" onClick={onCode}>
          <Code2 className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarBtn
          label="Modo código"
          onClick={() =>
            onViewModeChange(viewMode === "code" ? "split" : "code")
          }
          active={viewMode === "code"}
        >
          <Code className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <ToolbarBtn
          label="Modo visual"
          onClick={() =>
            onViewModeChange(viewMode === "visual" ? "split" : "visual")
          }
          active={viewMode === "visual"}
        >
          <Eye className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
      </div>
    </div>
  );
}

function ToolbarBtn({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded text-[var(--text-2)] transition-colors",
        "hover:bg-[var(--bg-muted)] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
        active && "bg-[var(--accent-soft)] text-[var(--accent)]",
      )}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span className="mx-1 h-5 w-px bg-[var(--border-sub)]" aria-hidden />;
}

interface FooterProps {
  saving: boolean;
  transitioning: boolean;
  lastSavedAt: Date | null;
  onBack: () => void;
  onNext: () => void;
  onSaveAndClose: () => void;
}

function Footer({
  saving,
  transitioning,
  lastSavedAt,
  onBack,
  onNext,
  onSaveAndClose,
}: FooterProps) {
  const savedLabel = useMemo(() => {
    if (saving) return "Salvando...";
    if (!lastSavedAt) return "";
    return `Salvo às ${formatTime(lastSavedAt)}`;
  }, [saving, lastSavedAt]);
  const disabled = transitioning;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[var(--bg-subtle)] px-4 py-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} disabled={disabled}>
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Voltar
        </Button>
        <span className="text-[11px] text-[var(--text-3)]">{savedLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onSaveAndClose} disabled={disabled}>
          {transitioning ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Save className="h-4 w-4" strokeWidth={1.5} />
          )}
          Salvar e Fechar
        </Button>
        <Button onClick={onNext} disabled={disabled}>
          Próximo
          <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
      className="text-[var(--accent)] underline underline-offset-2"
    >
      {children}
    </a>
  ),
};
