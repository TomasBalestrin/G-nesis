//! One-shot integration test: load the real skills/criar-sistema.md from the
//! repo root and confirm the parser accepts it.

use genesis_lib::orchestrator::skill_parser;

#[test]
fn criar_sistema_parses() {
    let content = include_str!("../../skills/criar-sistema.md");
    let skill = skill_parser::parse_skill(content).expect("parses");

    assert_eq!(skill.meta.name, "criar-sistema");
    assert_eq!(skill.tools, vec!["bash", "claude-code"]);
    assert!(skill.inputs.contains(&"briefing_path".to_string()));
    assert!(skill.inputs.contains(&"tasks_file".to_string()));

    // 3 explicit steps + step_loop captured separately.
    assert_eq!(skill.steps.len(), 3);
    assert_eq!(skill.steps[0].id, "step_1");
    assert_eq!(skill.steps[0].tool, "bash");
    assert_eq!(skill.steps[0].command.as_deref(), Some("npm install"));

    assert_eq!(skill.steps[1].tool, "claude-code");
    assert!(skill.steps[1].prompt.is_some());

    assert_eq!(skill.steps[2].tool, "bash");
    let step3_cmd = skill.steps[2].command.as_deref().unwrap();
    assert!(step3_cmd.contains("git"), "step 3 cmd: {step3_cmd}");
    assert!(step3_cmd.contains("commit"), "step 3 cmd: {step3_cmd}");

    let lp = skill.step_loop.as_ref().expect("step_loop present");
    assert_eq!(lp.until, "todas_tasks_concluidas");

    assert_eq!(skill.config.timeout, Some(900));
    assert_eq!(skill.config.retries, Some(3));
}
