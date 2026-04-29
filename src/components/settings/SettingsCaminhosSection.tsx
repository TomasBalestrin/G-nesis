import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  Pencil,
  Plus,
  Route as RouteIcon,
  Save,
  Trash2,
  X,
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import { createCaminho, deleteCaminho, listCaminhos } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import type { Caminho } from "@/types/caminho";

/**
 * Settings → /settings/caminhos. Catalogo de caminhos com card por
 * entrada (nome + path), edit inline (Pencil) e delete com confirm
 * (Trash2). Botão "Novo Caminho" abre form inline. O card em si NÃO
 * é clicável — toda navegação pra detalhe sai daqui.
 *
 * Edit não persiste: o backend `caminhos::*` só expõe list/create/delete.
 * Pencil mantém a UI pronta pra quando `update_caminho` for adicionado.
 */
export function SettingsCaminhosSection() {
  const [items, setItems] = useState<Caminho[] | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const list = await listCaminhos();
      setItems([...list].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      toast({
        title: "Falha ao carregar caminhos",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setItems([]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Caminhos</h2>
          <p className="text-sm text-[var(--text-2)]">
            Pastas locais que viram cwd da execução.
          </p>
        </div>
        <Button onClick={() => setCreating((c) => !c)} disabled={creating}>
          <Plus className="h-4 w-4" />
          Novo Caminho
        </Button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-3 p-6">
          {creating ? (
            <NewCaminhoCard
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                void refresh();
              }}
            />
          ) : null}

          {items === null ? (
            <p className="text-sm text-[var(--text-2)]">Carregando...</p>
          ) : items.length === 0 && !creating ? (
            <p className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-8 text-center text-sm text-[var(--text-2)]">
              Nenhum caminho cadastrado ainda.
            </p>
          ) : (
            items.map((c) => (
              <CaminhoCard key={c.id} caminho={c} onDeleted={refresh} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface CaminhoCardProps {
  caminho: Caminho;
  onDeleted: () => Promise<void>;
}

function CaminhoCard({ caminho, onDeleted }: CaminhoCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftName, setDraftName] = useState(caminho.name);
  const [draftPath, setDraftPath] = useState(caminho.repo_path);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  async function handleSaveEdit() {
    // Backend `update_caminho` ainda não existe — sinaliza claramente
    // sem inventar persistência fake. Quando a IPC for adicionada,
    // basta importar updateCaminho e chamar aqui.
    toast({
      title: "Edição de caminho indisponível",
      description:
        "Backend ainda não expõe update_caminho. O nome/path atuais foram preservados.",
      variant: "destructive",
    });
    setDraftName(caminho.name);
    setDraftPath(caminho.repo_path);
    setEditing(false);
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await deleteCaminho({ id: caminho.id });
      toast({ title: `Caminho ${caminho.name} removido` });
      await onDeleted();
    } catch (err) {
      toast({
        title: "Falha ao remover",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function pickFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Selecione a pasta do caminho",
    });
    if (typeof selected === "string") setDraftPath(selected);
  }

  return (
    <article
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3",
        editing && "ring-1 ring-[var(--accent)]",
      )}
    >
      <div className="flex items-start gap-3">
        <RouteIcon className="mt-1 h-4 w-4 shrink-0 text-[var(--text-3)]" />
        {editing ? (
          <div className="flex-1 space-y-2">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Nome"
            />
            <div className="flex gap-2">
              <Input
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                placeholder="/path/to/folder"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={pickFolder}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{caminho.name}</div>
            <div className="truncate font-mono text-xs text-[var(--text-2)]">
              {caminho.repo_path}
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {editing ? (
            <>
              <Button type="button" size="sm" onClick={handleSaveEdit}>
                <Save className="h-3.5 w-3.5" />
                Salvar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraftName(caminho.name);
                  setDraftPath(caminho.repo_path);
                  setEditing(false);
                }}
                aria-label="Cancelar edição"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <IconButton
                ariaLabel={`Editar ${caminho.name}`}
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                ariaLabel={`Remover ${caminho.name}`}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover caminho?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{caminho.name}</span> será apagado da
              base. Histórico de execução vinculado é preservado.
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
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

interface NewCaminhoCardProps {
  onCancel: () => void;
  onCreated: () => void;
}

function NewCaminhoCard({ onCancel, onCreated }: NewCaminhoCardProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (!trimmedName || !trimmedPath) {
      toast({ title: "Preencha nome e caminho", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createCaminho({ name: trimmedName, repoPath: trimmedPath });
      toast({ title: "Caminho criado" });
      onCreated();
    } catch (err) {
      toast({
        title: "Falha ao criar caminho",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function pickFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Selecione a pasta do caminho",
    });
    if (typeof selected === "string") setPath(selected);
  }

  return (
    <article className="rounded-lg border border-[var(--accent)] bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <Plus className="mt-1 h-4 w-4 shrink-0 text-[var(--accent)]" />
        <div className="flex-1 space-y-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do caminho"
            autoFocus
            disabled={saving}
          />
          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/usuario/pasta"
              className="font-mono"
              disabled={saving}
            />
            <Button
              type="button"
              variant="outline"
              onClick={pickFolder}
              disabled={saving}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

interface IconButtonProps {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}

function IconButton({ ariaLabel, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="rounded p-1.5 text-[var(--text-3)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
    >
      {children}
    </button>
  );
}
