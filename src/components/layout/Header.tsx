import { Menu, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="h-14 border-b border-border bg-surface flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Alternar menu"
          onClick={onMenuClick}
          className="min-[800px]:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold tracking-tight">Genesis</h1>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Configurações"
        onClick={() => navigate("/settings")}
      >
        <Settings className="h-5 w-5" />
      </Button>
    </header>
  );
}
