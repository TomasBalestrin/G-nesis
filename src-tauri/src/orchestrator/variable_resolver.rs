//! Resolves `{{variable}}` templates in step prompts/commands.
//! Uses the `regex` crate to substitute from a HashMap context.

use std::collections::HashMap;

pub fn resolve(_template: &str, _vars: &HashMap<String, String>) -> String {
    // TODO: regex replace `{{name}}` with vars[name]
    String::new()
}
