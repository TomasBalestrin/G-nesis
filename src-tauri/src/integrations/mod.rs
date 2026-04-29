//! External integrations registry — REST APIs the chat can hit via @-mentions.
//!
//! Persisted in `~/.genesis/config.toml` under `[integrations.<name>]` tables.
//! API keys live in those tables too but are NEVER on the public `Integration`
//! struct, so they can't accidentally cross the IPC boundary or land in a log
//! line. Read them on demand with [`get_api_key`].
//!
//! Module surface:
//!   - [`Integration`]: public metadata for one integration (no secret).
//!   - [`AuthType`]: how the API key is injected at request time.
//!   - [`load_integrations`] / [`get_api_key`] / [`save_integration`] /
//!     [`remove_integration`]: CRUD against the on-disk TOML.

pub mod config;

pub use config::{
    AuthType, Integration, get_api_key, load_integrations, remove_integration, save_integration,
};
