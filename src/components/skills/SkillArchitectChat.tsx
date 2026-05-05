import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  FileText,
  Loader2,
  Save,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownPreview } from "@/components/skills/MarkdownPreview";
import { useToast } from "@/hooks/useToast";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import {
  agentChat,
  saveGeneratedSkill,
  type AgentChatTurn,
  type SkillWriteRequest,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useSkillsStore } from "@/stores/skillsStore";

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** Timestamp pra dedup defensivo + key. Não exibido. */
  timestamp: number;
}

interface SkillArchitectChatProps {
  name: string;
  /** Chamado quando o usuário aborta o flow (botão Voltar +
   *  confirmação) ou quando a skill é salva com sucesso. */
  onExit: () => void;
}

const INITIAL_GREETING = (name: string) =>
  `Vou te ajudar a criar a skill **${name}**. Me conta: o que ela deve fazer?`;

const FILES_EVENT = "skill-architect:files-ready";

/**
 * Tela 2 do CreateSkillFlow — chat efêmero com o Skill Architect
 * (B1 backend). Mensagens vivem em memória; nada vai pra
 * `chat_messages`. Cada turno chama `agent_chat` IPC, que pode rodar
 * web_search internamente (B2). Quando o agente emite arquivos via
 * tags `{"skill_write": {...}}` (B3), o backend dispara o evento
 * `skill-architect:files-ready` que é acumulado em `pendingFiles`.
 *
 * "Salvar" só fica habilitado depois que existe pelo menos um SKILL.md
 * acumulado — saveGeneratedSkill (B4) materializa em disco e chama
 * onExit pra fechar o flow.
 */
export function SkillArchitectChat({ name, onExit }: SkillArchitectChatProps) {
  const { toast } = useToast();
  const refreshSkills = useSkillsStore((s) => s.refresh);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "greeting",
      role: "assistant",
      content: INITIAL_GREETING(name),
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // pendingFiles é dedup por path (Map). Cada turno pode reemitir
  // SKILL.md ajustado — última versão ganha. Eventos são best-effort
  // do backend; se a conexão Tauri falhar, o save final ainda valida
  // que tem um SKILL.md.
  const [pendingFiles, setPendingFiles] = useState<
    Map<string, SkillWriteRequest>
  >(() => new Map());
  const [saving, setSaving] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);

  useTauriEvent<SkillWriteRequest[]>(FILES_EVENT, (writes) => {
    setPendingFiles((prev) => {
      const next = new Map(prev);
      for (const w of writes) next.set(w.path, w);
      return next;
    });
  });

  const filesArray = useMemo(
    () => Array.from(pendingFiles.values()),
    [pendingFiles],
  );
  const hasSkillMd = filesArray.some((f) => f.path === "SKILL.md");

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    // Mostra a msg do usuário imediatamente; histórico passado pro
    // agente NÃO inclui a msg nova (vai como `message` separada).
    const history: AgentChatTurn[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const reply = await agentChat({
        agent: "skill-architect",
        message: trimmed,
        history,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: reply,
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      toast({
        title: "Skill Architect falhou",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  async function handleSave() {
    if (!hasSkillMd || saving) return;
    setSaving(true);
    try {
      await saveGeneratedSkill({ name, files: filesArray });
      await refreshSkills();
      toast({
        title: `Skill ${name} criada!`,
        description: `Use /${name} no chat.`,
      });
      onExit();
    } catch (err) {
      toast({
        title: "Falha ao salvar skill",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleBackRequest() {
    if (filesArray.length === 0 && messages.length <= 1) {
      onExit();
      return;
    }
    setConfirmBack(true);
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        name={name}
        canSave={hasSkillMd && !saving}
        saving={saving}
        onBack={handleBackRequest}
        onSave={handleSave}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {sending ? <ThinkingBubble /> : null}
            </div>
          </ScrollArea>
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => handleSend(input)}
            disabled={sending}
          />
        </main>
        <FilesPanel files={filesArray} />
      </div>

      <Dialog open={confirmBack} onOpenChange={setConfirmBack}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sair sem salvar?</DialogTitle>
            <DialogDescription>
              Toda a conversa e os arquivos gerados serão perdidos. Você
              pode voltar a criar essa skill depois, mas vai ter que
              começar de novo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBack(false)}>
              Continuar criando
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmBack(false);
                onExit();
              }}
            >
              Sair sem salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface HeaderProps {
  name: string;
  canSave: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}

function Header({ name, canSave, saving, onBack, onSave }: HeaderProps) {
  return (
    <header className="flex items-center gap-3 border-b border-border px-6 py-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Voltar"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
      </Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold">
          Criando: <span className="font-mono">{name}</span>
        </h2>
        <p className="text-xs text-[var(--text-3)]">
          Skill Architect — chat efêmero. Nada é salvo até você apertar
          Salvar.
        </p>
      </div>
      <Button onClick={onSave} disabled={!canSave}>
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <Save className="h-4 w-4" strokeWidth={1.5} />
        )}
        {saving ? "Salvando..." : "Salvar"}
      </Button>
    </header>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-[var(--accent)] text-[var(--accent-fg,white)]"
            : "bg-[var(--bg-subtle)] text-[var(--text)]",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownPreview
            content={message.content}
            className="mx-0 max-w-none px-0 py-0"
          />
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-2 rounded-2xl bg-[var(--bg-subtle)] px-4 py-2 text-xs text-[var(--text-2)]">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        Pensando... <span className="text-[var(--text-3)]">(pode incluir web search)</span>
      </div>
    </div>
  );
}

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}

function Composer({ value, onChange, onSend, disabled }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow simples — recalcula altura no input.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  }

  return (
    <div className="border-t border-border bg-[var(--bg-subtle)] px-4 py-3">
      <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-[var(--border-sub)] bg-background p-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Descreva o que a skill deve fazer..."
          disabled={disabled}
          rows={1}
          className="min-h-[28px] flex-1 resize-none bg-transparent px-2 py-1 text-sm focus:outline-none disabled:opacity-60"
        />
        <Button
          type="button"
          size="icon"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          aria-label="Enviar"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}

function FilesPanel({ files }: { files: SkillWriteRequest[] }) {
  if (files.length === 0) {
    return (
      <aside className="hidden w-64 shrink-0 border-l border-border bg-[var(--bg-subtle)]/40 px-4 py-4 text-xs text-[var(--text-3)] md:block">
        <p className="font-semibold uppercase tracking-wider">Arquivos</p>
        <p className="mt-2">
          Nenhum arquivo gerado ainda. O agente vai emitir{" "}
          <span className="font-mono">SKILL.md</span> e auxiliares
          conforme a conversa avança.
        </p>
      </aside>
    );
  }
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-border bg-[var(--bg-subtle)]/40 md:flex">
      <header className="border-b border-[var(--border-sub)] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        Arquivos pendentes ({files.length})
      </header>
      <ScrollArea className="flex-1">
        <ul className="space-y-1 p-2">
          {files.map((f) => (
            <li
              key={f.path}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs"
            >
              <CheckCircle2
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                strokeWidth={1.5}
              />
              <div className="min-w-0">
                <div className="truncate font-mono text-[11px]">{f.path}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-3)]">
                  <FileText className="h-3 w-3" strokeWidth={1.5} />
                  {formatBytes(f.content.length)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </aside>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} chars`;
  return `${(n / 1024).toFixed(1)} KB`;
}
