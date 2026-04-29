import { useEffect } from "react";
import { Plug, Sparkles, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useCapabilitiesStore } from "@/stores/capabilitiesStore";
import type { Capability, CapabilityType } from "@/types/capability";

/**
 * Catalog page for `/capabilities`. Two groups: `native` (shipped with
 * the app, channel-backed) and `connector` (third-party integrations
 * the user adds). Each card links to `/capabilities/:name` for the
 * detail view.
 *
 * The list reads from `capabilitiesStore` — first mount triggers
 * `ensureLoaded`, which hydrates from `list_capabilities`. Refresh
 * button re-runs the bridge call without invalidating cached items.
 */
export function CapabilityList() {
  const items = useCapabilitiesStore((s) => s.items);
  const loading = useCapabilitiesStore((s) => s.loading);
  const loaded = useCapabilitiesStore((s) => s.loaded);
  const error = useCapabilitiesStore((s) => s.error);
  const refresh = useCapabilitiesStore((s) => s.refresh);
  const ensureLoaded = useCapabilitiesStore((s) => s.ensureLoaded);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const natives = items.filter((c) => c.type === "native");
  const connectors = items.filter((c) => c.type === "connector");

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
          <Sparkles className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Capabilities</h1>
          <p className="text-xs text-[var(--text-secondary)]">
            O que o assistente pode invocar via @ no chat — natives
            embarcadas + connectors de terceiros.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl space-y-8 p-6">
          {error ? (
            <div className="rounded-xl border border-[var(--error)] bg-[var(--error-soft)] p-4 text-sm text-[var(--error)]">
              Falha ao carregar capabilities: {error}
            </div>
          ) : !loaded || (loading && items.length === 0) ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Carregando...
            </p>
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <Section
                title="Native"
                description="Embarcadas — comandos do sistema operacional ou CLIs locais."
                items={natives}
              />
              <Section
                title="Connectors"
                description="Integrações de terceiros adicionadas pelo usuário."
                items={connectors}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface SectionProps {
  title: string;
  description: string;
  items: Capability[];
}

function Section({ title, description, items }: SectionProps) {
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {title}
        </h2>
        <p className="text-xs text-[var(--text-tertiary)]">{description}</p>
      </header>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-tertiary)]/30 px-4 py-3 text-xs text-[var(--text-tertiary)]">
          {title === "Connectors"
            ? "Nenhum connector cadastrado ainda."
            : "Nenhuma capability deste tipo."}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((cap) => (
            <li key={cap.id}>
              <Link
                to={`/capabilities/${encodeURIComponent(cap.name)}`}
                className="block rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 shadow-sm transition-colors hover:bg-[var(--bg-hover)]"
              >
                <div className="flex items-start gap-3">
                  <CapabilityIcon type={cap.type} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {cap.display_name}
                      </span>
                      <span className="rounded-md bg-[var(--bg-tertiary)] px-1.5 py-0 font-mono text-[10px] text-[var(--text-secondary)]">
                        @{cap.name}
                      </span>
                      {cap.channel ? <ChannelBadge channel={cap.channel} /> : null}
                    </div>
                    {cap.description ? (
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {cap.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CapabilityIcon({ type }: { type: CapabilityType }) {
  const Icon = type === "native" ? Wrench : Plug;
  return (
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)]">
      <Icon className="h-4 w-4 text-[var(--accent)]" />
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0",
        "font-mono text-[10px] text-[var(--text-secondary)]",
        "border border-[var(--border-sub)] bg-[var(--bg-tertiary)]",
      )}
    >
      {channel}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
        <Sparkles className="h-5 w-5" />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        Nenhuma capability cadastrada.
      </p>
    </div>
  );
}
