import { ChevronDown, Cpu } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";

type Provider = "openai" | "anthropic";

interface ModelOption {
  id: string;
  label: string;
  provider: Provider;
  description: string;
}

// Backend currently routes through OpenAIClient only — the Anthropic entries
// are listed for forward-compat with the planned multi-provider router.
// Adding a model here without backend support means the selection persists
// but actual chat calls still use whatever the Rust side supports.
const MODELS: ModelOption[] = [
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    description: "Padrão · multimodal · 128k",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    description: "Mais rápido e barato",
  },
  {
    id: "gpt-4-turbo",
    label: "GPT-4 Turbo",
    provider: "openai",
    description: "Janela 128k · raciocínio denso",
  },
];

const PROVIDER_STYLES: Record<Provider, string> = {
  openai: "bg-[var(--tool-claude-code-soft)] text-[var(--tool-claude-code)]",
  anthropic: "bg-[var(--tool-bash-soft)] text-[var(--tool-bash)]",
};

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

function findModel(id: string): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

/**
 * Compact dropdown for picking which model the orchestrator uses. Sits
 * next to CaminhoSelector in the bottom row of the chat input.
 * Selection is persisted via app_state — backend reads `active_model_id`
 * when wiring the chat router (planned). For now the selection is
 * purely UI state.
 */
export function ModelSelector() {
  const activeModelId = useAppStore((s) => s.activeModelId);
  const setActiveModelId = useAppStore((s) => s.setActiveModelId);
  const active = findModel(activeModelId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Selecionar modelo de IA"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1",
            "text-xs text-[var(--text-tertiary)] transition-colors",
            "hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
          )}
        >
          <Cpu className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">{active.label}</span>
          <span className="sm:hidden">Modelo</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="min-w-[240px]"
      >
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
          Modelos
        </DropdownMenuLabel>
        {MODELS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => void setActiveModelId(m.id)}
            className={cn(
              "flex items-start gap-2 text-xs",
              m.id === activeModelId && "bg-[var(--accent-soft)]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--text-primary)]">
                  {m.label}
                </span>
                <ProviderBadge provider={m.provider} />
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                {m.description}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderBadge({ provider }: { provider: Provider }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0 font-mono text-[10px] font-semibold",
        PROVIDER_STYLES[provider],
      )}
    >
      {PROVIDER_LABEL[provider]}
    </span>
  );
}
