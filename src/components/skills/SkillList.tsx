import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTauriCommand } from "@/hooks/useTauriCommand";
import { useToast } from "@/hooks/useToast";
import { listSkills } from "@/lib/tauri-bridge";

export function SkillList() {
  const { data, loading, error, execute } = useTauriCommand(listSkills);
  const { toast } = useToast();

  useEffect(() => {
    execute();
  }, [execute]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Falha ao listar skills",
        description: error,
        variant: "destructive",
      });
    }
  }, [error, toast]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Skills</h2>
          <p className="text-sm text-[var(--text-2)]">
            Arquivos .md no diretório configurado.
          </p>
        </div>
        <Button asChild>
          <Link to="/skills/new">
            <Plus className="h-4 w-4" />
            Nova Skill
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
              {data.map((skill) => (
                <SkillCard key={skill.name} name={skill.name} description={skill.description} />
              ))}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

interface SkillCardProps {
  name: string;
  description: string;
}

function SkillCard({ name, description }: SkillCardProps) {
  return (
    <Link
      to={`/skills/${encodeURIComponent(name)}`}
      className="block rounded-xl focus-visible:outline-none"
    >
      <Card className="h-full cursor-pointer transition-colors hover:border-primary">
        <CardHeader>
          <CardTitle className="font-mono text-base">{name}</CardTitle>
          <CardDescription>
            {description || (
              <span className="italic text-[var(--text-dis)]">sem descrição</span>
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

function LoadingState() {
  return (
    <div className="py-16 text-center text-sm text-[var(--text-2)]">
      Carregando skills...
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-[var(--text-2)]">
        Nenhuma skill encontrada no diretório configurado.
      </p>
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to="/settings">Verificar configurações</Link>
        </Button>
        <Button asChild>
          <Link to="/skills/new">
            <Plus className="h-4 w-4" />
            Criar primeira skill
          </Link>
        </Button>
      </div>
    </div>
  );
}
