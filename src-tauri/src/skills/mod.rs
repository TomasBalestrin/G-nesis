//! Skills v2 storage — pasta-por-skill com SKILL.md +
//! references/ + assets/ + scripts/ (todas opcionais).
//!
//! Este módulo é o CRUD layer puro: list/read/create-dirs/delete em
//! cima do filesystem. Coexiste com `orchestrator::skill_loader_v2`
//! (que faz o parsing de frontmatter pra execução) e
//! `commands/skills.rs` (handlers IPC). Nada de parser, nada de
//! step validation aqui — só estrutura de diretórios.
//!
//! Regra "NUNCA criar subpastas vazias" (A1): `ensure_skill_dir` cria
//! apenas a raiz; subpastas vêm sob demanda via `create_subfolder`
//! quando o primeiro arquivo é gravado.

pub mod export;
pub mod import;
pub mod migration;
pub mod storage;

pub use export::export_skill_package;
pub use import::import_skill_package;
pub use migration::migrate_v1_skills;
pub use storage::{
    create_subfolder, delete_skill_package, ensure_skill_dir, ensure_skill_dirs,
    get_skill_package, list_assets, list_references, list_scripts,
    list_skill_packages, read_skill_md, skill_dir, skills_dir, SkillPackage,
};
