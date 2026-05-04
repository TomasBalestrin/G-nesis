import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";

import { useToast } from "@/hooks/useToast";
import { importSkill } from "@/lib/tauri-bridge";
import type { SkillPackage } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

interface ImportSkillZoneProps {
  onImported: () => Promise<void> | void;
}

/**
 * Dropzone + file picker pra importar `.skill` (ZIP). O Tauri
 * `dialog.open()` retorna o path absoluto, que vai direto pro
 * `import_skill` (backend descompacta de lá; nada cruza o IPC além
 * da string). O drop-event do navegador NÃO entrega caminho de FS —
 * por isso, mesmo no drop, abrimos o picker com `defaultPath` no
 * arquivo arrastado quando possível; senão, picker padrão.
 *
 * Validação de extensão é dupla: aqui (early-return com toast) e no
 * backend (tipo MIME / inspeção do ZIP). UI nunca cobre todos os
 * casos — vide `.skill` renomeado de `.zip` etc.
 */
export function ImportSkillZone({ onImported }: ImportSkillZoneProps) {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [lastImported, setLastImported] = useState<SkillPackage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function pickFile() {
    if (importing) return;
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Selecione um arquivo .skill",
        filters: [{ name: "Skill package", extensions: ["skill"] }],
      });
      if (typeof selected === "string") {
        await runImport(selected);
      }
    } catch (err) {
      toast({
        title: "Falha ao abrir o seletor",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function runImport(filePath: string) {
    if (!filePath.toLowerCase().endsWith(".skill")) {
      toast({
        title: "Arquivo inválido",
        description: "Apenas arquivos com extensão .skill são aceitos.",
        variant: "destructive",
      });
      return;
    }
    setImporting(true);
    try {
      const pkg = await importSkill({ filePath });
      setLastImported(pkg);
      toast({
        title: `Skill ${pkg.name} importada!`,
        description: `${pkg.files_count} arquivo(s) extraídos.`,
      });
      await onImported();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Falha ao importar skill",
        description: message,
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (importing) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".skill")) {
      toast({
        title: "Arquivo inválido",
        description: "Apenas arquivos com extensão .skill são aceitos.",
        variant: "destructive",
      });
      return;
    }
    // Browser drop não dá caminho absoluto — Tauri precisa do path no
    // disco pra ZipArchive::new abrir. Reabre o picker; é raro
    // chegar aqui em prod (a maioria dos users vai clicar mesmo).
    void pickFile();
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={pickFile}
        onDragOver={(e) => {
          e.preventDefault();
          if (!importing) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        disabled={importing}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors",
          dragActive
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border-sub)] hover:border-[var(--text-3)]",
          importing && "cursor-wait opacity-60",
        )}
      >
        {importing ? (
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-3)]" strokeWidth={1.5} />
        ) : (
          <Upload className="h-6 w-6 text-[var(--text-3)]" strokeWidth={1.5} />
        )}
        <span className="text-center text-[var(--text-2)]">
          {importing
            ? "Importando..."
            : "Arraste um arquivo .skill ou clique para selecionar"}
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".skill"
        className="hidden"
        onChange={(e) => {
          // Mantido só por defesa; o picker do Tauri é o caminho real.
          const file = e.target.files?.[0];
          if (!file) return;
          toast({
            title: "Use o seletor nativo",
            description: "Clique de novo na área para abrir o seletor.",
          });
        }}
      />

      {lastImported ? (
        <article className="flex items-start gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
            strokeWidth={1.5}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm font-medium">
              {lastImported.name}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-2)]">
              <span className="inline-flex items-center gap-1">
                <FileUp className="h-3 w-3" strokeWidth={1.5} />
                {lastImported.files_count} arquivo(s)
              </span>
              {lastImported.has_references ? (
                <span>references/ ✓</span>
              ) : null}
              {lastImported.has_assets ? <span>assets/ ✓</span> : null}
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
}
