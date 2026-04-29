import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Plug, Wrench } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getCapability } from "@/lib/tauri-bridge";
import type { Capability, CapabilityType } from "@/types/capability";

/**
 * Detail page for `/capabilities/:name`. Renders the user-facing copy
 * (`doc_user`) prominently and the system-prompt snippet (`doc_ai`)
 * inside a collapsible `<details>` so power users can audit what the
 * model actually sees without it dominating the page.
 *
 * Reads via `getCapability({ name })` on mount — no store dependency
 * here so deep-linking from the chat or sidebar works without
 * pre-loading the catalog.
 */
export function CapabilityDetail() {
  const { name = "" } = useParams<{ name: string }>();
  const [capability, setCapability] = useState<Capability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCapability({ name })
      .then((cap) => {
        if (cancelled) return;
        if (!cap) {
          setError(`Capability "${name}" não encontrada.`);
          return;
        }
        setCapability(cap);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/capabilities" aria-label="Voltar para a lista">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        {capability ? (
          <>
            <CapabilityIcon type={capability.type} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold">
                {capability.display_name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="rounded-md bg-[var(--bg-tertiary)] px-1.5 py-0 font-mono text-[10px]">
                  @{capability.name}
                </span>
                <TypeBadge type={capability.type} />
                {capability.channel ? (
                  <ChannelBadge channel={capability.channel} />
                ) : null}
                {capability.enabled === 0 ? (
                  <span className="rounded-full border border-[var(--border-sub)] bg-[var(--bg-tertiary)] px-2 py-0 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    desabilitada
                  </span>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">
              {name || "Capability"}
            </h1>
          </div>
        )}
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl p-6">
          {loading ? (
            <p className="text-sm text-[var(--text-secondary)]">Carregando...</p>
          ) : error ? (
            <div className="rounded-xl border border-[var(--error)] bg-[var(--error-soft)] p-4 text-sm text-[var(--error)]">
              {error}
            </div>
          ) : capability ? (
            <div className="space-y-6">
              {capability.description ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  {capability.description}
                </p>
              ) : null}

              {capability.doc_user ? (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Sobre
                  </h2>
                  <div className="prose-invert max-w-none text-sm leading-relaxed text-[var(--text-primary)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {capability.doc_user}
                    </ReactMarkdown>
                  </div>
                </section>
              ) : null}

              {capability.doc_ai ? (
                <section>
                  <details className="group rounded-xl border border-[var(--border-sub)] bg-[var(--bg-secondary)]">
                    <summary
                      className={cn(
                        "flex cursor-pointer list-none items-center justify-between gap-2",
                        "px-4 py-3 text-xs font-semibold uppercase tracking-wider",
                        "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                        "[&::-webkit-details-marker]:hidden",
                      )}
                    >
                      <span>System prompt (doc_ai)</span>
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-[var(--border-sub)] px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {capability.doc_ai}
                      </ReactMarkdown>
                    </div>
                  </details>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function CapabilityIcon({ type }: { type: CapabilityType }) {
  const Icon = type === "native" ? Wrench : Plug;
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
      <Icon className="h-5 w-5 text-[var(--accent)]" />
    </div>
  );
}

function TypeBadge({ type }: { type: CapabilityType }) {
  return (
    <span className="rounded-full border border-[var(--border-sub)] bg-[var(--bg-tertiary)] px-2 py-0 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
      {type}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-sub)] bg-[var(--bg-tertiary)] px-1.5 py-0 font-mono text-[10px] text-[var(--text-secondary)]">
      {channel}
    </span>
  );
}
