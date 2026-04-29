import { useEffect } from "react";
import { Plus, Route } from "lucide-react";
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
import { listCaminhos } from "@/lib/tauri-bridge";
import type { Caminho } from "@/types/caminho";

/**
 * Catalog page for `/caminhos`. User-facing rename of the legacy
 * ProjectList — same shape, swapped terminology + Route icon.
 * The Sidebar entry points here; deep links from the chat
 * (skill execution dropdown, system-state references) also land
 * on this list.
 */
export function CaminhoList() {
  const { data, loading, error, execute } = useTauriCommand(listCaminhos);
  const { toast } = useToast();

  useEffect(() => {
    execute();
  }, [execute]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Falha ao listar caminhos",
        description: error,
        variant: "destructive",
      });
    }
  }, [error, toast]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Caminhos</h2>
          <p className="text-sm text-[var(--text-2)]">
            Pastas locais onde as skills executam.
          </p>
        </div>
        <Button asChild>
          <Link to="/caminhos/new">
            <Plus className="h-4 w-4" />
            Novo Caminho
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
              {data.map((caminho) => (
                <CaminhoCard key={caminho.id} caminho={caminho} />
              ))}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

interface CaminhoCardProps {
  caminho: Caminho;
}

function CaminhoCard({ caminho }: CaminhoCardProps) {
  return (
    <Link
      to={`/caminhos/${caminho.id}`}
      className="block rounded-xl focus-visible:outline-none"
    >
      <Card className="h-full cursor-pointer transition-colors hover:border-primary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4 text-[var(--text-3)]" />
            <span className="truncate">{caminho.name}</span>
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs">
            {caminho.repo_path}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

function LoadingState() {
  return (
    <div className="py-16 text-center text-sm text-[var(--text-2)]">
      Carregando caminhos...
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-2)]">
        <Route className="h-5 w-5" />
      </div>
      <p className="text-sm text-[var(--text-2)]">
        Nenhum caminho cadastrado.
      </p>
      <Button asChild>
        <Link to="/caminhos/new">
          <Plus className="h-4 w-4" />
          Novo Caminho
        </Link>
      </Button>
    </div>
  );
}
