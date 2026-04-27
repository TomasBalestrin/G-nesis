//! Tauri IPC handlers. One module per feature area (see docs/architecture.md §1).

pub mod app_state;
pub mod chat;
pub mod config;
pub mod conversations;
pub mod dependencies;
pub mod execution;
pub mod knowledge;
pub mod projects;
pub mod skills;
pub mod workflows;
