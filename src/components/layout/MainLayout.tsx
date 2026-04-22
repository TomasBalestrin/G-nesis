import { useState } from "react";
import { Outlet } from "react-router-dom";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

export function MainLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  return (
    <div className="h-screen grid grid-rows-[auto_1fr_auto] grid-cols-[auto_1fr] overflow-hidden bg-background text-foreground">
      <div className="col-span-2 row-start-1">
        <Header onMenuClick={() => setDrawerOpen((o) => !o)} />
      </div>

      <div className="row-start-2 col-start-1 max-[800px]:col-span-2">
        <Sidebar open={drawerOpen} onNavigate={closeDrawer} />
      </div>

      <main className="row-start-2 col-start-2 max-[800px]:col-start-1 max-[800px]:col-span-2 overflow-auto">
        <Outlet />
      </main>

      <div className="col-span-2 row-start-3">
        <StatusBar />
      </div>

      {drawerOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={closeDrawer}
          className="fixed inset-0 z-30 bg-black/60 min-[800px]:hidden"
        />
      )}
    </div>
  );
}
