//! Validation of step outputs against expressions from the skill.
//!
//! Supported grammar (docs/architecture.md §Validator):
//! - `exit_code == N` / `exit_code != N`
//! - `output contains "X"` / `output not contains "X"`
//! - `<expr> and <expr>` (higher precedence than or)
//! - `<expr> or <expr>`
//!
//! Quoted strings are preserved during splitting so an ` and ` / ` or `
//! inside quotes does not cut the expression. No parentheses — keep skills
//! authors from building deeply nested predicates (if needed, stack them in
//! successive steps).

use crate::channels::ChannelOutput;

#[derive(Debug, PartialEq, Eq)]
pub enum StepResult {
    Success,
    Failed(String),
}

#[derive(Debug, PartialEq, Eq)]
enum Expr {
    ExitCodeEq(i32),
    ExitCodeNe(i32),
    OutputContains(String),
    OutputNotContains(String),
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
}

pub fn validate(expression: Option<&str>, output: &ChannelOutput) -> StepResult {
    let Some(raw) = expression else {
        return StepResult::Success;
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return StepResult::Success;
    }

    match parse(raw) {
        Ok(expr) => {
            if eval(&expr, output) {
                StepResult::Success
            } else {
                StepResult::Failed(format!("validação falhou: {raw}"))
            }
        }
        Err(msg) => StepResult::Failed(format!("expressão inválida (`{raw}`): {msg}")),
    }
}

// ── parser ──────────────────────────────────────────────────────────────────

fn parse(input: &str) -> Result<Expr, String> {
    parse_or(input)
}

fn parse_or(input: &str) -> Result<Expr, String> {
    let parts = split_top_level(input, " or ");
    let mut it = parts.into_iter();
    let first = it.next().ok_or("vazio")?;
    let mut expr = parse_and(first)?;
    for next in it {
        expr = Expr::Or(Box::new(expr), Box::new(parse_and(next)?));
    }
    Ok(expr)
}

fn parse_and(input: &str) -> Result<Expr, String> {
    let parts = split_top_level(input, " and ");
    let mut it = parts.into_iter();
    let first = it.next().ok_or("vazio")?;
    let mut expr = parse_atom(first)?;
    for next in it {
        expr = Expr::And(Box::new(expr), Box::new(parse_atom(next)?));
    }
    Ok(expr)
}

fn parse_atom(input: &str) -> Result<Expr, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("átomo vazio".into());
    }

    if let Some(rest) = s.strip_prefix("exit_code") {
        let rest = rest.trim_start();
        if let Some(v) = rest.strip_prefix("==") {
            return parse_i32(v).map(Expr::ExitCodeEq);
        }
        if let Some(v) = rest.strip_prefix("!=") {
            return parse_i32(v).map(Expr::ExitCodeNe);
        }
        return Err(format!("operador inválido após exit_code: `{rest}`"));
    }

    if let Some(rest) = s.strip_prefix("output") {
        let rest = rest.trim_start();
        if let Some(v) = rest.strip_prefix("not contains") {
            return Ok(Expr::OutputNotContains(unquote(v.trim()).to_string()));
        }
        if let Some(v) = rest.strip_prefix("contains") {
            return Ok(Expr::OutputContains(unquote(v.trim()).to_string()));
        }
        return Err(format!("operador inválido após output: `{rest}`"));
    }

    Err(format!("átomo não reconhecido: `{s}`"))
}

fn parse_i32(raw: &str) -> Result<i32, String> {
    raw.trim()
        .parse::<i32>()
        .map_err(|_| format!("valor numérico inválido: `{raw}`"))
}

fn unquote(s: &str) -> &str {
    let s = s.trim();
    if s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"'))
            || (s.starts_with('\'') && s.ends_with('\'')))
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Split `s` by `sep` at positions outside of quoted substrings.
fn split_top_level<'a>(s: &'a str, sep: &str) -> Vec<&'a str> {
    let bytes = s.as_bytes();
    let sep_bytes = sep.as_bytes();
    let mut parts: Vec<&str> = Vec::new();
    let mut in_quote: Option<u8> = None;
    let mut start = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        let b = bytes[i];
        match in_quote {
            Some(q) => {
                if b == q {
                    in_quote = None;
                }
                i += 1;
            }
            None => {
                if b == b'"' || b == b'\'' {
                    in_quote = Some(b);
                    i += 1;
                } else if i + sep_bytes.len() <= bytes.len()
                    && &bytes[i..i + sep_bytes.len()] == sep_bytes
                {
                    parts.push(&s[start..i]);
                    i += sep_bytes.len();
                    start = i;
                } else {
                    i += 1;
                }
            }
        }
    }
    parts.push(&s[start..]);
    parts
}

// ── evaluator ───────────────────────────────────────────────────────────────

fn eval(expr: &Expr, out: &ChannelOutput) -> bool {
    match expr {
        Expr::ExitCodeEq(n) => out.exit_code == Some(*n),
        Expr::ExitCodeNe(n) => out.exit_code != Some(*n),
        Expr::OutputContains(needle) => {
            out.stdout.contains(needle) || out.stderr.contains(needle)
        }
        Expr::OutputNotContains(needle) => {
            !out.stdout.contains(needle) && !out.stderr.contains(needle)
        }
        Expr::And(a, b) => eval(a, out) && eval(b, out),
        Expr::Or(a, b) => eval(a, out) || eval(b, out),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_output() -> ChannelOutput {
        ChannelOutput {
            stdout: "hello world\nall good".into(),
            stderr: String::new(),
            exit_code: Some(0),
            ..Default::default()
        }
    }

    fn fail_output() -> ChannelOutput {
        ChannelOutput {
            stdout: String::new(),
            stderr: "boom: failed to connect".into(),
            exit_code: Some(1),
            ..Default::default()
        }
    }

    #[test]
    fn none_or_empty_expression_succeeds() {
        assert!(matches!(validate(None, &ok_output()), StepResult::Success));
        assert!(matches!(validate(Some(""), &ok_output()), StepResult::Success));
        assert!(matches!(validate(Some("   "), &ok_output()), StepResult::Success));
    }

    #[test]
    fn exit_code_comparisons() {
        assert!(matches!(
            validate(Some("exit_code == 0"), &ok_output()),
            StepResult::Success
        ));
        assert!(matches!(
            validate(Some("exit_code != 0"), &fail_output()),
            StepResult::Success
        ));
        assert!(matches!(
            validate(Some("exit_code == 0"), &fail_output()),
            StepResult::Failed(_)
        ));
    }

    #[test]
    fn output_contains_checks_stdout_and_stderr() {
        assert!(matches!(
            validate(Some(r#"output contains "hello""#), &ok_output()),
            StepResult::Success
        ));
        assert!(matches!(
            validate(Some(r#"output contains "boom""#), &fail_output()),
            StepResult::Success
        ));
        assert!(matches!(
            validate(Some(r#"output contains "unicorn""#), &ok_output()),
            StepResult::Failed(_)
        ));
    }

    #[test]
    fn output_not_contains() {
        assert!(matches!(
            validate(Some(r#"output not contains "boom""#), &ok_output()),
            StepResult::Success
        ));
        assert!(matches!(
            validate(Some(r#"output not contains "hello""#), &ok_output()),
            StepResult::Failed(_)
        ));
    }

    #[test]
    fn and_requires_both() {
        let expr = r#"exit_code == 0 and output contains "hello""#;
        assert!(matches!(validate(Some(expr), &ok_output()), StepResult::Success));
        assert!(matches!(
            validate(Some(expr), &fail_output()),
            StepResult::Failed(_)
        ));
    }

    #[test]
    fn or_requires_either() {
        let expr = r#"exit_code == 42 or output contains "hello""#;
        assert!(matches!(validate(Some(expr), &ok_output()), StepResult::Success));
        let expr2 = r#"exit_code == 42 or output contains "unicorn""#;
        assert!(matches!(
            validate(Some(expr2), &ok_output()),
            StepResult::Failed(_)
        ));
    }

    #[test]
    fn and_binds_tighter_than_or() {
        // a or b and c === a or (b and c)
        let expr = r#"exit_code == 42 or exit_code == 0 and output contains "hello""#;
        assert!(matches!(validate(Some(expr), &ok_output()), StepResult::Success));
    }

    #[test]
    fn and_or_inside_quotes_is_literal() {
        // " and " inside the string literal must not be treated as an operator.
        let expr = r#"output contains "rock and roll""#;
        let out = ChannelOutput {
            stdout: "best rock and roll band".into(),
            ..Default::default()
        };
        assert!(matches!(validate(Some(expr), &out), StepResult::Success));
    }

    #[test]
    fn malformed_expression_fails_with_reason() {
        let err = validate(Some("exit_code is zero"), &ok_output());
        let StepResult::Failed(msg) = err else {
            panic!("expected Failed");
        };
        assert!(msg.contains("expressão inválida"), "msg was: {msg}");
    }
}
