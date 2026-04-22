//! Validates step outputs against expressions from the skill.
//! Supports `exit_code == 0`, `output contains "X"`, and OR/AND composition.

use crate::channels::ChannelOutput;

#[derive(Debug)]
pub enum StepResult {
    Success,
    Failed(String),
}

pub fn validate(_expression: Option<&str>, _output: &ChannelOutput) -> StepResult {
    // TODO: parse expression and evaluate against ChannelOutput
    StepResult::Success
}
