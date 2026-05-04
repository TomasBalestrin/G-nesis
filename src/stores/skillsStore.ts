import { create } from "zustand";

import {
  getSkill,
  listSkillPackages as bridgeListPackages,
  listSkills as bridgeList,
  type SkillPackage,
} from "@/lib/tauri-bridge";
import type { Skill, SkillDetail, SkillMeta } from "@/types/skill";

interface SkillsState {
  /** Skills v2 unificadas (frontmatter + package + mirror SQLite).
   *  Sorted por name pra UI determinística. */
  items: Skill[];
  /** Skill atualmente aberta no SkillDetailView — full bundle com
   *  content + references + assets. `null` quando nenhuma view ativa. */
  activeSkill: SkillDetail | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch o catálogo (listSkills + listSkillPackages em paralelo). */
  refresh: () => Promise<void>;
  /** Cheap noop quando já hidratado; primeiro call popula. */
  ensureLoaded: () => Promise<void>;
  /** Carrega o bundle completo de uma skill via getSkill IPC e seta
   *  como activeSkill. Garante que o catálogo esteja hidratado antes
   *  pra ter os campos de meta. Erra silenciosamente — caller pode
   *  inspecionar `activeSkill === null` pós-call pra detectar falha. */
  setActive: (name: string) => Promise<void>;
  /** Reset de `activeSkill` — útil ao desmontar SkillDetailView. */
  clearActive: () => void;
}

function mergeIntoSkill(
  meta: SkillMeta,
  pkg: SkillPackage | undefined,
): Skill {
  return {
    id: pkg?.id ?? meta.name,
    name: meta.name,
    description: meta.description,
    version: meta.version,
    author: meta.author,
    has_assets: pkg?.has_assets ?? false,
    has_references: pkg?.has_references ?? false,
    files_count: pkg?.files_count ?? 1,
    references_count: pkg?.references_count ?? 0,
    assets_count: pkg?.assets_count ?? 0,
    created_at: pkg?.created_at ?? "",
  };
}

function buildItems(metas: SkillMeta[], pkgs: SkillPackage[]): Skill[] {
  const byName = new Map<string, SkillPackage>();
  for (const p of pkgs) byName.set(p.name, p);
  return metas
    .map((m) => mergeIntoSkill(m, byName.get(m.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  items: [],
  activeSkill: null,
  loading: false,
  loaded: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const [metas, pkgs] = await Promise.all([
        bridgeList(),
        bridgeListPackages().catch(() => [] as SkillPackage[]),
      ]);
      set({
        items: buildItems(metas, pkgs),
        loading: false,
        loaded: true,
      });
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async ensureLoaded() {
    if (get().loaded || get().loading) return;
    await get().refresh();
  },

  async setActive(name) {
    // Garante que `items` está populado pra ter meta da skill —
    // bundle do backend traz package + content/refs/assets, mas
    // não re-deriva description/version/author do frontmatter.
    await get().ensureLoaded();
    try {
      const bundle = await getSkill({ name });
      const skill =
        get().items.find((s) => s.name === name) ??
        // Skill recém-criada que ainda não entrou no items[] —
        // monta uma versão mínima a partir do bundle.package.
        mergeIntoSkill(
          {
            name,
            description: "",
            version: bundle.package.id ? "1.0" : "1.0",
            author: "",
          },
          bundle.package,
        );
      set({
        activeSkill: {
          ...skill,
          content: bundle.skill_md,
          references: bundle.references,
          assets: bundle.assets,
        },
      });
    } catch (err) {
      set({
        activeSkill: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clearActive() {
    set({ activeSkill: null });
  },
}));
