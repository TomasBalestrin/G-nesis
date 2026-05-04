//! Skills v2 storage — pasta-por-skill com SKILL.md + assets/ + references/.
//!
//! Este módulo é o CRUD layer puro: list/read/create-dirs/delete em
//! cima do filesystem. Coexiste com `orchestrator::skill_loader_v2`
//! (que faz o parsing de frontmatter pra execução) e
//! `commands/skills.rs` (handlers IPC). Nada de parser, nada de
//! step validation aqui — só estrutura de diretórios.

pub mod storage;

pub use storage::{
    delete_skill_package, ensure_skill_dirs, get_skill_package, list_assets,
    list_references, list_skill_packages, read_skill_md, skill_dir, skills_dir,
    SkillPackage,
};
