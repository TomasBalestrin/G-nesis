import { useState } from "react";
import type { FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FolderOpen, Save } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import { createProject } from "@/lib/tauri-bridge";

export function NewProjectForm() {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  async function pickFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Selecione o diretório do projeto",
      });
      if (typeof selected === "string") {
        setRepoPath(selected);
      }
    } catch (err) {
      toast({
        title: "Falha ao abrir seletor de pasta",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPath = repoPath.trim();
    if (!trimmedName || !trimmedPath) {
      toast({
        title: "Preencha nome e caminho",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const project = await createProject({
        name: trimmedName,
        repoPath: trimmedPath,
      });
      toast({ title: "Projeto criado" });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast({
        title: "Falha ao criar projeto",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = name.trim().length > 0 && repoPath.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Novo Projeto</h2>
          <p className="text-xs text-[var(--text-2)]">
            Aponte para um repositório local.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-xl space-y-6 p-6"
          aria-label="Criar projeto"
        >
          <div className="space-y-2">
            <label htmlFor="project-name" className="text-sm font-medium">
              Nome
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="meu-projeto"
              autoFocus
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="project-path" className="text-sm font-medium">
              Caminho do repositório
            </label>
            <div className="flex gap-2">
              <Input
                id="project-path"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/home/usuario/projetos/meu-projeto"
                disabled={saving}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={pickFolder}
                disabled={saving}
              >
                <FolderOpen className="h-4 w-4" />
                Selecionar
              </Button>
            </div>
            <p className="text-xs text-[var(--text-3)]">
              O backend valida que o caminho existe e é um diretório.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button asChild variant="outline" type="button" disabled={saving}>
              <Link to="/projects">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={!canSubmit || saving}>
              <Save className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
