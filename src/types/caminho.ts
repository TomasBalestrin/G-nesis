// User-facing alias for `Project` — Genesis migrated the surface
// vocabulary from "project" to "caminho" (Portuguese for "path").
// Schema + DB row + legacy `Project` type stay unchanged; this file
// is just the renamed handle so frontend code can read naturally.
//
// Mirrors `pub type Caminho = Project;` in src-tauri/src/db/models.rs.

import type { Project } from "./project";

export type Caminho = Project;
