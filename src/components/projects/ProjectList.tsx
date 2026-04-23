import { useEffect } from "react";
import { FolderGit2, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTauriCommand } from "@/hooks/useTauriCommand";
import { useToast } from "@/hooks/useToast";
import { listProjects } from "@/lib/tauri-bridge";
import type { Project } from "@/types/project";

export function ProjectList() {
  const { data, loading, error, execute } = useTauriCommand(listProjects);
  const { toast } = useToast();

  useEffect(() => {
    execute();
  }, [execute]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Falha ao listar projetos",
        description: error,
        variant: "destructive",
      });
    }
  }, [error, toast]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Projetos</h2>
          <p className="text-sm text-[var(--text-2)]">
            Repositórios locais onde as skills executam.
          </p>
        </div>
        <Button asChild>
          <Link to="/projects/new">
            <Plus className="h-4 w-4" />
            Novo Projeto
          </Link>
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl p-6">
          {loading && !data ? (
            <LoadingState />
          ) : data && data.length === 0 ? (
            <EmptyState />
          ) : data ? (
            <div className="grid gap-4 md:grid-cols-2">
              {data.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
}

function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="block rounded-xl focus-visible:outline-none"
    >
      <Card className="h-full cursor-pointer transition-colors hover:border-primary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderGit2 className="h-4 w-4 text-[var(--text-3)]" />
            <span className="truncate">{project.name}</span>
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs">
            {project.repo_path}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

function LoadingState() {
  return (
    <div className="py-16 text-center text-sm text-[var(--text-2)]">
      Carregando projetos...
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-2)]">
        <FolderGit2 className="h-5 w-5" />
      </div>
      <p className="text-sm text-[var(--text-2)]">
        Nenhum projeto cadastrado.
      </p>
      <Button asChild>
        <Link to="/projects/new">
          <Plus className="h-4 w-4" />
          Novo Projeto
        </Link>
      </Button>
    </div>
  );
}
