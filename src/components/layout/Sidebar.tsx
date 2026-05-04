import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  Download,
  FileCode,
  Folder,
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
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
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/hooks/useToast";
import {
  deleteSkill,
  exportSkill,
  importSkill,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useSkillsStore } from "@/stores/skillsStore";
import type { Conversation } from "@/types/chat";
import type { Skill } from "@/types/skill";

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const navigate = useNavigate();
  const createConversation = useConversationsStore((s) => s.create);
  const { toast } = useToast();

  async function handleNewChat() {
    const conv = await createConversation();
    if (conv) {
      navigate(`/chat/${conv.id}`);
      onNavigate();
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
      className={cn(
        "flex w-[260px] flex-col border-r bg-[var(--sb-bg)] border-[var(--sb-bd)]",
        // Mobile drawer
        "max-[800px]:fixed max-[800px]:inset-y-0 max-[800px]:z-40",
        "max-[800px]:transition-transform max-[800px]:duration-200",
        open
          ? "max-[800px]:translate-x-0"
          : "max-[800px]:-translate-x-full",
      )}
    >
      <div className="px-3 pt-4">
        <Button
          onClick={handleNewChat}
          className="w-full justify-start"
          aria-label="Nova conversa"
        >
          <Plus className="h-4 w-4" />
          Nova conversa
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        <ChatsSection onNavigate={onNavigate} />
        <SkillsSection onNavigate={onNavigate} />
      </nav>

      <Footer />
    </aside>
  );
}

// ── sections ────────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}

function SectionHeader({ label, open, onToggle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex flex-1 items-center gap-1 rounded-md py-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] transition-colors hover:text-[var(--text-2)] focus-visible:outline-none"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        {label}
      </button>
      {action}
    </div>
  );
}

function ChatsSection({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useState(true);
  const items = useConversationsStore((s) => s.items);
  const loaded = useConversationsStore((s) => s.loaded);
  const loading = useConversationsStore((s) => s.loading);
  const ensureLoaded = useConversationsStore((s) => s.ensureLoaded);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  return (
    <section>
      <SectionHeader label="Chats" open={open} onToggle={() => setOpen((o) => !o)} />
      {open ? (
        <div className="mt-1 space-y-0.5">
          {!loaded && loading ? (
            <p className="px-2 py-1 text-xs text-[var(--text-3)]">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--text-3)]">
              Nenhuma conversa ainda.
            </p>
          ) : (
            items.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  onNavigate: () => void;
}

function ConversationItem({ conversation, onNavigate }: ConversationItemProps) {
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

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Apagar conversa "${conversation.title}"? As mensagens vão junto.`)) {
      return;
    }
    try {
      await remove(conversation.id);
      if (isActive) {
        navigate("/");
      }
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
      <form onSubmit={handleRenameSubmit} className="px-2">
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
          className="h-8 w-full rounded-md border border-primary bg-[var(--input-bg)] px-2 text-sm text-[var(--text)] focus:outline-none"
        />
      </form>
    );
  }

  return (
    <NavLink
      to={`/chat/${conversation.id}`}
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-sm transition-colors duration-100",
        isActive
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
      )}
    >
      <MessageSquare
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isActive ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]",
        )}
      />
      <span className="flex-1 truncate" title={conversation.title}>
        {conversation.title}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton
          ariaLabel="Renomear"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDraftTitle(conversation.title);
            setEditing(true);
          }}
        >
          <Pencil className="h-3 w-3" />
        </IconButton>
        <IconButton ariaLabel="Apagar" onClick={handleDelete}>
          <Trash2 className="h-3 w-3" />
        </IconButton>
      </span>
    </NavLink>
  );
}

interface IconButtonProps {
  ariaLabel: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

function IconButton({ ariaLabel, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="rounded p-1 text-[var(--text-3)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)] focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

// ── skills section ──────────────────────────────────────────────────────────

function SkillsSection({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useState(true);
  const items = useSkillsStore((s) => s.items);
  const loading = useSkillsStore((s) => s.loading);
  const loaded = useSkillsStore((s) => s.loaded);
  const ensureLoaded = useSkillsStore((s) => s.ensureLoaded);
  const refresh = useSkillsStore((s) => s.refresh);
  const { toast } = useToast();

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  // File picker via tauri-plugin-dialog → IPC import_skill → refresh.
  // Mesma UX da ImportSkillZone em Settings, mas inline na sidebar.
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
        label="Skills"
        open={open}
        onToggle={() => setOpen((o) => !o)}
        action={
          <span className="flex items-center">
            <button
              type="button"
              onClick={handleImport}
              aria-label="Importar skill (.skill)"
              title="Importar .skill"
              className="rounded p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--sb-hover)] hover:text-[var(--text)]"
            >
              <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <Link
              to="/skills/new"
              onClick={onNavigate}
              aria-label="Nova skill"
              title="Nova skill"
              className="rounded p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--sb-hover)] hover:text-[var(--text)]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Link>
          </span>
        }
      />
      {open ? (
        <div className="mt-1 space-y-0.5">
          {loading && !loaded ? (
            <p className="px-2 py-1 text-xs text-[var(--text-3)]">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--text-3)]">
              Nenhuma skill.
            </p>
          ) : (
            items.map((skill) => (
              <SkillItem
                key={skill.name}
                skill={skill}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

interface SkillItemProps {
  skill: Skill;
  onNavigate: () => void;
}

function SkillItem({ skill, onNavigate }: SkillItemProps) {
  const { name: routeName } = useParams<{ name: string }>();
  const isActive = routeName === skill.name;
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const referencesCount = skill.references_count;
  const hasAssets = skill.has_assets;
  const hasReferences = skill.has_references;
  const detailHref = `/skills/${encodeURIComponent(skill.name)}`;

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
    try {
      const dest = await saveDialog({
        title: "Exportar skill",
        defaultPath: `${skill.name}.skill`,
        filters: [{ name: "Skill package", extensions: ["skill"] }],
      });
      if (!dest) return;
      await exportSkill({ name: skill.name, destPath: dest });
      toast({ title: `Skill exportada`, description: dest });
    } catch (err) {
      toast({
        title: "Falha ao exportar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  function openDetail() {
    navigate(detailHref);
    onNavigate();
  }

  return (
    <>
      <div
        className={cn(
          "group rounded-md border-l-2 transition-colors duration-100",
          isActive
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-transparent hover:bg-[var(--bg-hover)]",
        )}
      >
        <div className="flex items-center gap-1 px-1 py-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Colapsar" : "Expandir"}
            aria-expanded={expanded}
            className="rounded p-0.5 text-[var(--text-3)] hover:text-[var(--text)] focus-visible:outline-none"
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform duration-150",
                expanded && "rotate-90",
              )}
              strokeWidth={1.5}
            />
          </button>
          <button
            type="button"
            onClick={openDetail}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 text-left"
          >
            <FileCode
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isActive
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-3)]",
              )}
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate font-mono text-xs",
                  isActive
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-2)]",
                )}
              >
                {skill.name}
              </span>
            </span>
            {referencesCount > 0 ? (
              <span
                className="shrink-0 rounded-full bg-[var(--bg-muted)] px-1.5 text-[10px] font-medium text-[var(--text-2)]"
                title={`${referencesCount} reference(s)`}
              >
                {referencesCount}
              </span>
            ) : null}
          </button>
          <SkillDropdown
            onEdit={() => {
              navigate(`${detailHref}/edit`);
              onNavigate();
            }}
            onExport={handleExport}
            onDelete={() => setConfirmOpen(true)}
          />
        </div>

        {expanded ? (
          <ul className="space-y-0.5 pb-1 pl-7 pr-2">
            <SkillTreeItem
              icon={
                <FileCode
                  className="h-3 w-3 shrink-0"
                  strokeWidth={1.5}
                />
              }
              label="SKILL.md"
              onClick={openDetail}
            />
            {hasReferences ? (
              <SkillTreeItem
                icon={
                  <Folder className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                }
                label="references/"
                count={referencesCount}
                onClick={openDetail}
              />
            ) : null}
            {hasAssets ? (
              <SkillTreeItem
                icon={
                  <ImageIcon
                    className="h-3 w-3 shrink-0"
                    strokeWidth={1.5}
                  />
                }
                label="assets/"
                count={skill.assets_count}
                onClick={openDetail}
              />
            ) : null}
          </ul>
        ) : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deletar skill?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{skill.name}</span> será removida do
              skills_dir. Esta ação não pode ser desfeita. Execuções em
              andamento bloqueiam a deleção.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deletando..." : "Deletar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface SkillTreeItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}

function SkillTreeItem({ icon, label, count, onClick }: SkillTreeItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[11px] text-[var(--text-2)] transition-colors hover:bg-[var(--bg-muted)]"
      >
        {icon}
        <span className="truncate font-mono">{label}</span>
        {typeof count === "number" && count > 0 ? (
          <span className="ml-auto text-[10px] text-[var(--text-3)]">
            {count}
          </span>
        ) : null}
      </button>
    </li>
  );
}

interface SkillDropdownProps {
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function SkillDropdown({ onEdit, onExport, onDelete }: SkillDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Mais ações"
          onClick={(e) => e.stopPropagation()}
          className="rounded p-1 text-[var(--text-3)] opacity-0 transition-opacity hover:bg-[var(--bg-muted)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3 w-3" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
          Editar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExport}>
          <Download className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
          Exportar
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

// ── footer ──────────────────────────────────────────────────────────────────

function Footer() {
  const { isDark, toggle } = useTheme();
  return (
    <div className="flex items-center justify-between gap-2 border-t border-[var(--sb-bd)] px-3 py-3">
      <div className="flex items-center gap-1">
        <Link
          to="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--sb-text)] transition-colors hover:bg-[var(--sb-hover)]"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
        className="rounded-md p-2 text-[var(--sb-text)] transition-colors hover:bg-[var(--sb-hover)] focus-visible:outline-none"
      >
        {isDark ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
