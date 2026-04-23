import { useState } from "react";
import { Outlet } from "react-router-dom";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

/**
 * App shell — three-row grid (header / main+sidebar / statusbar) with a
 * two-column inner row. The first column uses `auto` width so it follows
 * Sidebar's breakpoint widths (200/60/200 px per docs/ux-flows.md §6).
 *
 * Below 800px the Sidebar is rendered with `position: fixed` and slides in as
 * a drawer; that removes it from grid flow so the `auto` column collapses to
 * 0 and `<main>` gets the full width via `col-span-2`.
 */
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

      <main className="row-start-2 col-start-2 min-w-0 overflow-auto max-[800px]:col-start-1 max-[800px]:col-span-2">
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
