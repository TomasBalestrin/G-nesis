import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  MoreVertical,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  PlusCircle,
  Trash2,
  Upload,
} from "lucide-react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/useToast";
import {
  deleteSkill,
  exportSkill,
  importSkill,
  moveFile,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useSkillsStore } from "@/stores/skillsStore";
import type { Conversation } from "@/types/chat";
import type { Skill } from "@/types/skill";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Sidebar do Genesis (Figma v2). Dois estados visuais:
 *
 *   - **Expandida (315px)**: logo "Genesis OS", "Nova conversa",
 *     section Chats, section Skill, frase rodapé.
 *   - **Colapsada (122px)**: ícone de toggle + Plus circular + ícones
 *     dos items ATIVOS de chats e skills (apenas o item selecionado
 *     da rota corrente). Sem texto, sem scroll, sem rodapé.
 *
 * Settings + theme toggle SAÍRAM do rodapé — agora moram no AppHeader.
 * Mobile drawer também removido (Genesis é desktop). Tokens consumidos
 * via `var(--gv2-*)` direto via inline style ou className arbitrária
 * `[var(--gv2-*)]` — alinhado com o cutover incremental do Figma v2.
 */
export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const navigate = useNavigate();
  const createConversation = useConversationsStore((s) => s.create);
  const { toast } = useToast();

  async function handleNewChat() {
    const conv = await createConversation();
    if (conv) {
      navigate(`/chat/${conv.id}`);
    } else {
      toast({
        title: "Falha ao criar conversa",
        variant: "destructive",
      });
    }
  }

  return (
    <aside
      aria-label="Navegação principal"
      className="flex h-full shrink-0 flex-col border-r transition-[width] duration-200 ease-out"
      style={{
        width: collapsed
          ? "var(--gv2-sidebar-collapsed)"
          : "var(--gv2-sidebar-width)",
        background: "var(--gv2-bg)",
        borderColor: "var(--gv2-border)",
        padding: collapsed ? "30px 20px" : "30px",
      }}
    >
      {collapsed ? (
        <CollapsedSidebar
          onToggleCollapsed={onToggleCollapsed}
          onNewChat={handleNewChat}
        />
      ) : (
        <ExpandedSidebar
          onToggleCollapsed={onToggleCollapsed}
          onNewChat={handleNewChat}
        />
      )}
    </aside>
  );
}

// ── expanded ────────────────────────────────────────────────────────────────

interface ExpandedSidebarProps {
  onToggleCollapsed: () => void;
  onNewChat: () => void;
}

function ExpandedSidebar({
  onToggleCollapsed,
  onNewChat,
}: ExpandedSidebarProps) {
  return (
    <>
      {/* Topo: logo + collapse */}
      <div className="flex items-center justify-between">
        <span
          className="select-none"
          style={{
            fontFamily: "Lora, serif",
            fontWeight: 600,
            fontSize: "25px",
            color: "var(--gv2-brand)",
            lineHeight: 1,
          }}
        >
          Genesis OS
        </span>
        <button
          type="button"
          aria-label="Colapsar sidebar"
          onClick={onToggleCollapsed}
          className="rounded p-1 transition-colors hover:bg-[var(--gv2-active-bg)]"
        >
          <PanelLeftClose
            className="h-[18px] w-[18px]"
            style={{ color: "var(--gv2-text-secondary)" }}
            strokeWidth={1.5}
          />
        </button>
      </div>

      {/* Gap 70px → "Nova conversa" */}
      <div className="mt-[70px]">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 transition-opacity hover:opacity-90"
          style={{
            background: "var(--gv2-brand-button)",
            color: "var(--gv2-text)",
            borderRadius: "var(--gv2-radius-sm)",
            padding: "15px 25px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            fontWeight: 500,
          }}
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
          <span>Nova conversa</span>
        </button>
      </div>

      {/* Gap 40px → seção Chats */}
      <div className="mt-[40px] flex-1 overflow-y-auto">
        <ChatsSection />
        <Separator />
        <SkillsSection />
      </div>

      {/* Rodapé com a frase */}
      <QuoteFooter />
    </>
  );
}

function Separator() {
  return (
    <div
      className="my-[17px]"
      style={{
        height: "1px",
        background: "var(--gv2-border)",
      }}
    />
  );
}

function QuoteFooter() {
  return (
    <div className="mt-[40px]">
      <p
        style={{
          fontFamily: "Lora, serif",
          fontSize: "15px",
          fontWeight: 400,
          color: "var(--gv2-text-secondary)",
          lineHeight: 1.6,
        }}
      >
        A melhor maneira de começar alguma coisa é parar de falar e dar o
        primeiro passo.
      </p>
      <div
        className="my-[10px]"
        style={{ height: "1px", background: "var(--gv2-border)" }}
      />
      <p
        style={{
          fontFamily: "Lora, serif",
          fontSize: "12px",
          fontWeight: 400,
          color: "var(--gv2-text-secondary)",
        }}
      >
        Walt Disney
      </p>
    </div>
  );
}

// ── collapsed ───────────────────────────────────────────────────────────────

interface CollapsedSidebarProps {
  onToggleCollapsed: () => void;
  onNewChat: () => void;
}

function CollapsedSidebar({
  onToggleCollapsed,
  onNewChat,
}: CollapsedSidebarProps) {
  const conversationsItems = useConversationsStore((s) => s.items);
  const skillsItems = useSkillsStore((s) => s.items);
  const ensureConversations = useConversationsStore((s) => s.ensureLoaded);
  const ensureSkills = useSkillsStore((s) => s.ensureLoaded);

  useEffect(() => {
    void ensureConversations();
    void ensureSkills();
  }, [ensureConversations, ensureSkills]);

  const { conversationId } = useParams<{ conversationId: string }>();
  const { name: skillName } = useParams<{ name: string }>();
  const activeChat = conversationsItems.find((c) => c.id === conversationId);
  const activeSkill = skillsItems.find((s) => s.name === skillName);

  return (
    <div className="flex h-full flex-col items-center gap-[20px]">
      <button
        type="button"
        aria-label="Expandir sidebar"
        onClick={onToggleCollapsed}
        className="rounded p-1 transition-colors hover:bg-[var(--gv2-active-bg)]"
      >
        <PanelLeft
          className="h-[18px] w-[18px]"
          style={{ color: "var(--gv2-text-secondary)" }}
          strokeWidth={1.5}
        />
      </button>

      <button
        type="button"
        onClick={onNewChat}
        aria-label="Nova conversa"
        className="flex h-[42px] w-[42px] items-center justify-center transition-opacity hover:opacity-90"
        style={{
          background: "var(--gv2-brand-button)",
          borderRadius: "9999px",
          color: "var(--gv2-text)",
        }}
      >
        <Plus className="h-3 w-3" strokeWidth={2} />
      </button>

      {activeChat ? (
        <Link
          to={`/chat/${activeChat.id}`}
          aria-label={activeChat.title}
          className="flex h-[36px] w-[36px] items-center justify-center"
          style={{
            background: "var(--gv2-active-bg)",
            color: "var(--gv2-active-text)",
            borderRadius: "9999px",
          }}
        >
          <MessageSquare className="h-3 w-3" strokeWidth={1.5} />
        </Link>
      ) : null}

      <div
        className="w-full"
        style={{ height: "1px", background: "var(--gv2-border)" }}
      />

      {activeSkill ? (
        <Link
          to={`/settings/skill/${encodeURIComponent(activeSkill.name)}`}
          aria-label={activeSkill.name}
          className="flex h-[36px] w-[36px] items-center justify-center"
          style={{
            background: "var(--gv2-active-bg)",
            color: "var(--gv2-active-text)",
            borderRadius: "9999px",
          }}
        >
          <FileText
            style={{ width: "10px", height: "12px" }}
            strokeWidth={1.5}
          />
        </Link>
      ) : null}
    </div>
  );
}

// ── chats section ───────────────────────────────────────────────────────────

function ChatsSection() {
  const [open, setOpen] = useState(true);
  const items = useConversationsStore((s) => s.items);
  const loaded = useConversationsStore((s) => s.loaded);
  const loading = useConversationsStore((s) => s.loading);
  const ensureLoaded = useConversationsStore((s) => s.ensureLoaded);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  return (
    <section>
      <SectionHeader
        label="Chats"
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />
      {open ? (
        <div className="mt-[10px] space-y-[10px]">
          {!loaded && loading ? (
            <p
              className="px-[25px]"
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "15px",
                color: "var(--gv2-text-secondary)",
              }}
            >
              Carregando...
            </p>
          ) : items.length === 0 ? (
            <p
              className="px-[25px]"
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "15px",
                color: "var(--gv2-text-secondary)",
              }}
            >
              Nenhuma conversa ainda.
            </p>
          ) : (
            items.map((c) => <ConversationItem key={c.id} conversation={c} />)
          )}
        </div>
      ) : null}
    </section>
  );
}

interface SectionHeaderProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
}

function SectionHeader({
  label,
  open,
  onToggle,
  rightAction,
}: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex flex-1 items-center gap-2 transition-opacity hover:opacity-80"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "transition-transform duration-150",
            open ? "rotate-0" : "-rotate-90",
          )}
          style={{
            width: "8px",
            height: "4px",
            color: "var(--gv2-text-secondary)",
          }}
        />
        <span
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            fontWeight: 400,
            color: "var(--gv2-text-secondary)",
          }}
        >
          {label}
        </span>
      </button>
      {rightAction}
    </div>
  );
}

function ConversationItem({ conversation }: { conversation: Conversation }) {
  const { conversationId: active } = useParams<{ conversationId: string }>();
  const isActive = active === conversation.id;
  const rename = useConversationsStore((s) => s.rename);
  const remove = useConversationsStore((s) => s.remove);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);

  async function handleRenameSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = draftTitle.trim();
    setEditing(false);
    if (!title || title === conversation.title) return;
    try {
      await rename(conversation.id, title);
    } catch (err) {
      toast({
        title: "Falha ao renomear",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Apagar conversa "${conversation.title}"? As mensagens vão junto.`,
      )
    )
      return;
    try {
      await remove(conversation.id);
      if (isActive) navigate("/");
    } catch (err) {
      toast({
        title: "Falha ao apagar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleRenameSubmit} className="px-[10px]">
        <input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={handleRenameSubmit as unknown as React.FocusEventHandler}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraftTitle(conversation.title);
              setEditing(false);
            }
          }}
          className="w-full rounded-[10px] focus:outline-none"
          style={{
            background: "var(--gv2-input-bg)",
            border: "1px solid var(--gv2-input-border)",
            padding: "15px 25px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            color: "var(--gv2-text)",
          }}
        />
      </form>
    );
  }

  return (
    <NavLink
      to={`/chat/${conversation.id}`}
      className="group flex items-center gap-2 transition-colors"
      style={{
        background: isActive ? "var(--gv2-active-bg)" : "transparent",
        color: isActive
          ? "var(--gv2-active-text)"
          : "var(--gv2-text-secondary)",
        borderRadius: "var(--gv2-radius-sm)",
        padding: "15px 25px",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "15px",
      }}
    >
      <MessageSquare className="h-3 w-3 shrink-0" strokeWidth={1.5} />
      <span className="flex-1 truncate" title={conversation.title}>
        {conversation.title}
      </span>
      {isActive ? (
        <ConversationDropdown
          onRename={() => {
            setDraftTitle(conversation.title);
            setEditing(true);
          }}
          onDelete={handleDelete}
        />
      ) : null}
    </NavLink>
  );
}

function ConversationDropdown({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Mais ações"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="rounded p-1 transition-colors hover:bg-[var(--gv2-active-bg)]"
        >
          <MoreVertical
            style={{ width: "2px", height: "14px" }}
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
          Renomear
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="text-[var(--destructive)] focus:text-[var(--destructive)]"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
          Apagar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── skills section ──────────────────────────────────────────────────────────

function SkillsSection() {
  const [open, setOpen] = useState(true);
  const items = useSkillsStore((s) => s.items);
  const loading = useSkillsStore((s) => s.loading);
  const loaded = useSkillsStore((s) => s.loaded);
  const ensureLoaded = useSkillsStore((s) => s.ensureLoaded);
  const refresh = useSkillsStore((s) => s.refresh);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  async function handleImport() {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Importar arquivo .skill",
        filters: [{ name: "Skill package", extensions: ["skill"] }],
      });
      if (typeof selected !== "string") return;
      const pkg = await importSkill({ filePath: selected });
      toast({
        title: `Skill ${pkg.name} importada`,
        description: `${pkg.files_count} arquivo(s).`,
      });
      await refresh();
    } catch (err) {
      toast({
        title: "Falha ao importar skill",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <section>
      <SectionHeader
        label="Skill"
        open={open}
        onToggle={() => setOpen((o) => !o)}
        rightAction={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate("/skills/new")}
              aria-label="Nova skill"
              className="rounded p-1 transition-colors hover:bg-[var(--gv2-active-bg)]"
            >
              <PlusCircle
                style={{ width: "8px", height: "8px" }}
                strokeWidth={2}
              />
            </button>
            <button
              type="button"
              onClick={handleImport}
              aria-label="Importar .skill"
              title="Importar .skill"
              className="rounded p-1 transition-colors hover:bg-[var(--gv2-active-bg)]"
            >
              <Upload
                style={{ width: "10px", height: "10px" }}
                strokeWidth={1.5}
              />
            </button>
          </div>
        }
      />
      {open ? (
        <div className="mt-[10px] space-y-[10px]">
          {loading && !loaded ? (
            <p
              className="px-[25px]"
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "15px",
                color: "var(--gv2-text-secondary)",
              }}
            >
              Carregando...
            </p>
          ) : items.length === 0 ? (
            <p
              className="px-[25px]"
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "15px",
                color: "var(--gv2-text-secondary)",
              }}
            >
              Nenhuma skill.
            </p>
          ) : (
            items.map((skill) => <SkillItem key={skill.name} skill={skill} />)
          )}
        </div>
      ) : null}
    </section>
  );
}

function SkillItem({ skill }: { skill: Skill }) {
  const { name: routeName } = useParams<{ name: string }>();
  const isActive = routeName === skill.name;
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const detailHref = `/settings/skill/${encodeURIComponent(skill.name)}`;

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await deleteSkill({ name: skill.name });
      toast({ title: `Skill ${skill.name} deletada` });
      await refreshSkills();
      if (isActive) navigate("/");
    } catch (err) {
      toast({
        title: "Falha ao deletar skill",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const tempPath = await exportSkill({ name: skill.name });
      const dest = await saveDialog({
        title: "Exportar skill",
        defaultPath: `${skill.name}.skill`,
        filters: [{ name: "Skill package", extensions: ["skill"] }],
      });
      if (!dest) return;
      await moveFile({ src: tempPath, dest });
      toast({ title: `Skill exportada`, description: dest });
    } catch (err) {
      toast({
        title: "Falha ao exportar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <NavLink
        to={detailHref}
        className="group flex items-center gap-2 transition-colors"
        style={{
          background: isActive ? "var(--gv2-active-bg)" : "transparent",
          color: isActive
            ? "var(--gv2-active-text)"
            : "var(--gv2-text-secondary)",
          borderRadius: "var(--gv2-radius-sm)",
          padding: "15px 25px",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
        }}
      >
        <FileText
          className="shrink-0"
          style={{ width: "10px", height: "12px" }}
          strokeWidth={1.5}
        />
        <span className="flex-1 truncate font-mono">{skill.name}</span>
        {isActive ? (
          <SkillDropdown
            exporting={exporting}
            onEdit={() => navigate(`/skills/${encodeURIComponent(skill.name)}/edit`)}
            onExport={handleExport}
            onDelete={() => setConfirmOpen(true)}
          />
        ) : null}
      </NavLink>

      {/* Sub-itens só aparecem quando a skill é a ativa (skill detail
          mostra os arquivos no 3º painel também; aqui é só hint). */}
      {isActive ? <SkillSubItems skill={skill} /> : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deletar skill?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{skill.name}</span> será removida do
              skills_dir. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
              className="px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="rounded-[10px] px-4 py-2 text-sm text-white"
              style={{ background: "var(--destructive, #C4453A)" }}
            >
              {deleting ? "Deletando..." : "Deletar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SkillSubItems({ skill }: { skill: Skill }) {
  const items: string[] = ["SKILL.md"];
  if (skill.has_references) items.push("references/");
  if (skill.has_assets) items.push("assets/");
  if (skill.has_scripts) items.push("scripts/");
  return (
    <ul>
      {items.map((label) => (
        <li
          key={label}
          style={{
            paddingLeft: "39px",
            paddingTop: "5px",
            paddingBottom: "5px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "13px",
            color: "var(--gv2-active-text)",
          }}
        >
          {label}
        </li>
      ))}
    </ul>
  );
}

interface SkillDropdownProps {
  exporting: boolean;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function SkillDropdown({
  exporting,
  onEdit,
  onExport,
  onDelete,
}: SkillDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Mais ações"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="rounded p-1 transition-colors hover:bg-[var(--gv2-active-bg)]"
        >
          {exporting ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          ) : (
            <MoreHorizontal className="h-3 w-3" strokeWidth={1.5} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
          Editar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExport} disabled={exporting}>
          {exporting ? (
            <Loader2
              className="mr-2 h-3.5 w-3.5 animate-spin"
              strokeWidth={1.5}
            />
          ) : (
            <Download className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {exporting ? "Exportando..." : "Exportar .skill"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="text-[var(--destructive)] focus:text-[var(--destructive)]"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
          Deletar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
