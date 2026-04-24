import { useState } from "react";
import { Menu } from "lucide-react";
import { Outlet } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Sidebar } from "./Sidebar";

/**
 * App shell for the ChatGPT-like layout: 260px sidebar on the left, main
 * content takes the rest. On `< 800px` the sidebar becomes a drawer toggled
 * by the hamburger in the floating mobile bar. No narrow rail mode anymore —
 * the sidebar lists conversations and skills, which need width to breathe.
 */
export function MainLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar open={drawerOpen} onNavigate={closeDrawer} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader onMenuClick={() => setDrawerOpen((o) => !o)} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {drawerOpen ? (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={closeDrawer}
          className="fixed inset-0 z-30 bg-black/60 min-[800px]:hidden"
        />
      ) : null}
    </div>
  );
}

function MobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 min-[800px]:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenuClick}
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="font-bold tracking-tight">Genesis</span>
    </header>
  );
}
