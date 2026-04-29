//! Resolve `{{variable}}` templates in skill steps (prompts, commands, etc.).
//!
//! Context has 3 namespaces — inputs (user-provided at activation), runtime
//! (step outputs as execution progresses), tasks (current iterator entry in
//! step_loop). Bare `{{x}}` falls through inputs → runtime → tasks in that
//! order. Explicit `{{inputs.x}}` / `{{runtime.x}}` / `{{tasks.x}}` short-
//! circuits to one namespace. Missing variables produce a structured error
//! mentioning where the resolver looked. No recursive substitution: a value
//! that contains `{{y}}` is emitted literally.

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;

fn var_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Identifier segments (letters / digits / underscore) joined by dots.
        Regex::new(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}")
            .expect("variable regex")
    })
}

#[derive(Debug, Default, Clone)]
pub struct ResolveContext {
    pub inputs: HashMap<String, String>,
    pub runtime: HashMap<String, String>,
    pub tasks: HashMap<String, String>,
}

impl ResolveContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_inputs(mut self, inputs: HashMap<String, String>) -> Self {
        self.inputs = inputs;
        self
    }

    pub fn set_input(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.inputs.insert(key.into(), value.into());
    }

    pub fn set_runtime(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.runtime.insert(key.into(), value.into());
    }

    pub fn set_task(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.tasks.insert(key.into(), value.into());
    }

    /// Pre-populate the inputs namespace with the active project's metadata
    /// so skills can reference `{{repo_path}}`, `{{project_name}}` and
    /// `{{project_id}}` without declaring them in the skill's `# Inputs`
    /// section. Called by `execute_skill` after resolving the project.
    pub fn with_project(
        mut self,
        repo_path: impl Into<String>,
        name: impl Into<String>,
        id: impl Into<String>,
    ) -> Self {
        self.set_input("repo_path", repo_path);
        self.set_input("project_name", name);
        self.set_input("project_id", id);
        self
    }

    fn lookup(&self, key: &str) -> Option<&str> {
        if let Some((ns, rest)) = key.split_once('.') {
            let ns_map: Option<&HashMap<String, String>> = match ns {
                "inputs" => Some(&self.inputs),
                "runtime" => Some(&self.runtime),
                "tasks" => Some(&self.tasks),
                _ => None,
            };
            if let Some(map) = ns_map {
                return map.get(rest).map(String::as_str);
            }
        }
        // Unprefixed (or unknown prefix treated as full key) — fall through.
        self.inputs
            .get(key)
            .or_else(|| self.runtime.get(key))
            .or_else(|| self.tasks.get(key))
            .map(String::as_str)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VariableError {
    /// Variable name was not found in any namespace.
    Missing(String),
}

impl std::fmt::Display for VariableError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // `{{{{` / `}}}}` escape pairs in format strings produce literal `{{` / `}}`.
            Self::Missing(name) => write!(
                f,
                "variável `{{{{{name}}}}}` não encontrada em inputs/runtime/tasks"
            ),
        }
    }
}

impl std::error::Error for VariableError {}

/// Replace every `{{name}}` in `template` with the value from `ctx`.
/// Returns the first missing variable's error without emitting partial output.
pub fn resolve(template: &str, ctx: &ResolveContext) -> Result<String, VariableError> {
    let re = var_regex();
    let mut out = String::with_capacity(template.len());
    let mut last = 0usize;

    for caps in re.captures_iter(template) {
        let full = caps.get(0).expect("whole match");
        let name = caps.get(1).expect("capture group").as_str();

        out.push_str(&template[last..full.start()]);

        let value = ctx
            .lookup(name)
            .ok_or_else(|| VariableError::Missing(name.to_string()))?;
        out.push_str(value);

        last = full.end();
    }
    out.push_str(&template[last..]);
    Ok(out)
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> ResolveContext {
        ResolveContext::default()
    }

    #[test]
    fn resolves_inputs_variable() {
        let mut c = ctx();
        c.set_input("briefing_path", "/tmp/b.md");

        let out = resolve("Leia {{briefing_path}} e gere", &c).unwrap();
        assert_eq!(out, "Leia /tmp/b.md e gere");
    }

    #[test]
    fn explicit_namespace_lookup() {
        let mut c = ctx();
        c.set_runtime("step_1.output", "resultado");

        let out = resolve("{{runtime.step_1.output}}", &c).unwrap();
        assert_eq!(out, "resultado");
    }

    #[test]
    fn bare_name_falls_through_namespaces() {
        let mut c = ctx();
        c.set_task("current", "task-42");

        let out = resolve("Processando {{current}}", &c).unwrap();
        assert_eq!(out, "Processando task-42");
    }

    #[test]
    fn inputs_wins_over_runtime_and_tasks() {
        let mut c = ctx();
        c.set_input("x", "from-inputs");
        c.set_runtime("x", "from-runtime");
        c.set_task("x", "from-tasks");

        assert_eq!(resolve("{{x}}", &c).unwrap(), "from-inputs");
        assert_eq!(resolve("{{runtime.x}}", &c).unwrap(), "from-runtime");
        assert_eq!(resolve("{{tasks.x}}", &c).unwrap(), "from-tasks");
    }

    #[test]
    fn missing_variable_errors_with_clear_message() {
        let c = ctx();
        let err = resolve("inicio {{missing}} fim", &c).unwrap_err();
        assert_eq!(err, VariableError::Missing("missing".to_string()));

        let msg = err.to_string();
        assert!(msg.contains("`{{missing}}`"), "msg was: {msg}");
        assert!(msg.contains("inputs/runtime/tasks"), "msg was: {msg}");
    }

    #[test]
    fn multiple_occurrences_and_mixed_text() {
        let mut c = ctx();
        c.set_input("x", "A");
        c.set_input("y", "B");

        let out = resolve("{{x}}-{{y}}-{{x}}", &c).unwrap();
        assert_eq!(out, "A-B-A");
    }

    #[test]
    fn whitespace_inside_braces_is_tolerated() {
        let mut c = ctx();
        c.set_input("x", "42");

        let out = resolve("{{ x }} e {{x}} e {{\tx\t}}", &c).unwrap();
        assert_eq!(out, "42 e 42 e 42");
    }

    #[test]
    fn text_without_variables_returned_unchanged() {
        let c = ctx();
        assert_eq!(resolve("nada aqui", &c).unwrap(), "nada aqui");
        assert_eq!(resolve("", &c).unwrap(), "");
    }

    #[test]
    fn substitution_is_not_recursive() {
        let mut c = ctx();
        c.set_input("x", "{{y}}");
        c.set_input("y", "REAL");

        let out = resolve("{{x}}", &c).unwrap();
        assert_eq!(out, "{{y}}");
    }

    #[test]
    fn malformed_tokens_are_left_alone() {
        let c = ctx();
        // single braces or unclosed — regex won't match, template stays intact.
        let template = "use {foo} and {{unclosed";
        assert_eq!(resolve(template, &c).unwrap(), template);
    }

    #[test]
    fn unknown_prefix_falls_back_to_flat_lookup() {
        let mut c = ctx();
        c.set_input("weird.name", "works");

        // "weird" is not a known namespace, so the full dotted key is used
        // as a flat lookup across all maps.
        let out = resolve("{{weird.name}}", &c).unwrap();
        assert_eq!(out, "works");
    }

    #[test]
    fn with_project_seeds_repo_path_and_name_and_id() {
        let c =
            ResolveContext::new().with_project("/Users/me/repos/genesis", "Genesis", "0000-uuid");

        assert_eq!(
            resolve(
                "cd {{repo_path}} && echo {{project_name}} ({{project_id}})",
                &c,
            )
            .unwrap(),
            "cd /Users/me/repos/genesis && echo Genesis (0000-uuid)",
        );
        // Explicit namespace also works.
        assert_eq!(resolve("{{inputs.project_name}}", &c).unwrap(), "Genesis",);
    }
}
