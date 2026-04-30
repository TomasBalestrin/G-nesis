import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Cable,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/useToast";
import {
  listIntegrations,
  removeIntegration,
  testIntegration,
  updateIntegration,
} from "@/lib/tauri-bridge";
import type { IntegrationRow } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

/**
 * Settings → Integrações. Lista de integrations cadastradas (cards) +
 * botão "Nova Integração" que abre o modal de criação. Embedado dentro
 * de SettingsConfigSection — não tem rota nem entry no sidebar.
 *
 * O modal de criação completo (form com nome, base_url, auth_type,
 * api_key, spec) chega na D2; aqui é só um stub clicável pra completar
 * o fluxo visual.
 */
export function IntegrationsSection() {
  const [items, setItems] = useState<IntegrationRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const list = await listIntegrations();
      setItems(list);
    } catch (err) {
      toast({
        title: "Falha ao carregar integrations",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setItems([]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Nova Integração
        </Button>
      </div>

      {items === null ? (
        <p className="text-xs text-[var(--text-2)]">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-6 text-center text-xs text-[var(--text-2)]">
          Nenhuma integração cadastrada ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => (
            <IntegrationCard key={row.id} row={row} onChanged={refresh} />
          ))}
        </ul>
      )}

      {/* Stub pro modal de criação — D2 substitui pelo form completo. */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Integração</DialogTitle>
            <DialogDescription>
              O formulário de criação será adicionado em D2 (nome, base
              URL, auth, api key, spec).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface IntegrationCardProps {
  row: IntegrationRow;
  onChanged: () => Promise<void>;
}

function IntegrationCard({ row, onChanged }: IntegrationCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<null | "test" | "toggle" | "remove">(null);
  const { toast } = useToast();
  const enabled = row.enabled === 1;

  async function handleTest() {
    setBusy("test");
    try {
      const result = await testIntegration({ name: row.name });
      toast({
        title: result.ok
          ? `${row.display_name} OK (${result.elapsed_ms} ms)`
          : `${row.display_name} falhou`,
        description: result.message,
        variant: result.ok ? "default" : "destructive",
      });
      await onChanged();
    } catch (err) {
      toast({
        title: "Erro de configuração",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleToggle() {
    // Toggle só é seguro pra `bearer` — o updateIntegration exige
    // authType completo, e header/query carregam header_name /
    // param_name no config.toml que a UI ainda não consegue ler
    // (não há getter expondo o payload completo). Re-enviar com
    // strings vazias clobbera a TOML. Pra header/query, instruir
    // o usuário a editar via D2.
    if (row.auth_type !== "bearer") {
      toast({
        title: "Toggle indisponível pra esse auth_type",
        description:
          "Use o formulário de edição completo (em breve, D2) pra alterar enabled em integrations com auth de header/query — direto aqui clobbera o header_name / param_name no config.toml.",
        variant: "destructive",
      });
      return;
    }
    setBusy("toggle");
    try {
      await updateIntegration({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        baseUrl: row.base_url,
        authType: { type: "bearer" },
        enabled: !enabled,
      });
      await onChanged();
    } catch (err) {
      toast({
        title: "Falha ao alternar enabled",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirmRemove() {
    setBusy("remove");
    try {
      await removeIntegration({ name: row.name });
      toast({ title: `Integração ${row.display_name} removida` });
      await onChanged();
    } catch (err) {
      toast({
        title: "Falha ao remover",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <Cable className="mt-1 h-4 w-4 shrink-0 text-[var(--text-3)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{row.display_name}</span>
            <EnabledBadge enabled={enabled} />
          </div>
          <div className="truncate font-mono text-xs text-[var(--text-2)]">
            {row.base_url}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-3)]">
            {row.last_used_at
              ? `Último uso: ${formatTimestamp(row.last_used_at)}`
              : "Nunca usada"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={busy !== null}
          >
            {busy === "test" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Testar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleToggle}
            disabled={busy !== null}
            aria-label={enabled ? "Desabilitar" : "Habilitar"}
            title={enabled ? "Desabilitar" : "Habilitar"}
          >
            {busy === "toggle" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : enabled ? (
              <Power className="h-3.5 w-3.5" />
            ) : (
              <PowerOff className="h-3.5 w-3.5 text-[var(--text-3)]" />
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
            disabled={busy !== null}
            aria-label="Remover"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover integração?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{row.display_name}</span> será
              removida do SQLite, do <span className="font-mono">config.toml</span>{" "}
              (junto com a api_key) e do arquivo de spec local. A ação
              não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRemove(false)}
              disabled={busy === "remove"}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRemove}
              disabled={busy === "remove"}
            >
              {busy === "remove" ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold",
        enabled
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "bg-[var(--bg-muted)] text-[var(--text-3)]",
      )}
    >
      {enabled ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {enabled ? "Ativa" : "Off"}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  // ISO é o formato gravado pelo backend (strftime('%Y-%m-%dT%H:%M:%fZ').
  // Usar new Date() funciona; queda no `iso` cru se o parse falhar evita
  // crash no card.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
