//! Spec file storage for integrations.
//!
//! Each integration gets a markdown file at
//! `~/.genesis/integrations/<name>.md` that GPT reads to learn how to
//! call the API — endpoints, auth notes, example payloads. The
//! directory is created at startup so first-run installs don't surface
//! "no such directory" when the user registers their first integration.
//!
//! All public helpers key by the integration `name` (the @-mention
//! handle); the on-disk extension and the parent directory are owned
//! by this module so callers don't have to know the layout.

use std::fs;
use std::path::PathBuf;

use crate::config::config_dir;

const SPEC_EXTENSION: &str = "md";

/// Absolute path to `~/.genesis/integrations/`. Just a path build —
/// does NOT touch the filesystem; pair with [`ensure_specs_dir`] when
/// you need the directory to exist.
pub fn specs_dir() -> PathBuf {
    config_dir().join("integrations")
}

/// Idempotent: creates `~/.genesis/integrations/` if missing. Called
/// once at startup; safe to call again at any time (mkdir -p semantics).
pub fn ensure_specs_dir() -> Result<(), String> {
    let dir = specs_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))
}

/// Write the spec file for `name`. Overwrites any existing content
/// — callers that want to preserve previous bytes should `load_spec`
/// first and merge. `ensure_specs_dir` is invoked here too so the
/// caller doesn't need to remember the lazy-create dance.
pub fn save_spec(name: &str, content: &str) -> Result<(), String> {
    ensure_specs_dir()?;
    let path = spec_path(name);
    fs::write(&path, content).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Returns the spec content for `name`, or `None` when the file is
/// absent. Other I/O errors (permission denied, invalid UTF-8) bubble
/// up as `Err` so the caller can distinguish "not configured" from
/// "configured but unreadable".
pub fn load_spec(name: &str) -> Result<Option<String>, String> {
    let path = spec_path(name);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

/// Idempotent: removes the spec file for `name`. Missing file is
/// success (returns Ok), so callers cleaning up after a failed add
/// don't have to special-case "never created".
pub fn delete_spec(name: &str) -> Result<(), String> {
    let path = spec_path(name);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot remove {}: {e}", path.display())),
    }
}

/// True when `~/.genesis/integrations/<name>.md` is on disk. Cheap
/// metadata stat — no read of the contents. Useful for picker UIs that
/// want to surface "spec available" badges without paying for the read.
pub fn spec_exists(name: &str) -> bool {
    spec_path(name).exists()
}

// ── internals ───────────────────────────────────────────────────────────────

fn spec_path(name: &str) -> PathBuf {
    specs_dir().join(format!("{name}.{SPEC_EXTENSION}"))
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip happy path: save, load, exists, delete, gone.
    /// Uses a unique name so concurrent test runs don't clobber each
    /// other (cargo test default jobs > 1).
    #[test]
    fn round_trip_save_load_delete() {
        let unique = format!("__a4_test_{}", std::process::id());
        // Defensive cleanup in case a previous run aborted mid-test.
        let _ = delete_spec(&unique);

        assert!(!spec_exists(&unique));
        assert!(matches!(load_spec(&unique), Ok(None)));

        save_spec(&unique, "# hello\n").unwrap();
        assert!(spec_exists(&unique));
        assert_eq!(load_spec(&unique).unwrap().as_deref(), Some("# hello\n"));

        save_spec(&unique, "# overwritten\n").unwrap();
        assert_eq!(
            load_spec(&unique).unwrap().as_deref(),
            Some("# overwritten\n")
        );

        delete_spec(&unique).unwrap();
        assert!(!spec_exists(&unique));
        // Idempotent: second delete is a no-op.
        delete_spec(&unique).unwrap();
    }

    #[test]
    fn ensure_specs_dir_is_idempotent() {
        ensure_specs_dir().unwrap();
        ensure_specs_dir().unwrap();
        assert!(specs_dir().exists());
    }
}
