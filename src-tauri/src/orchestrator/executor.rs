//! Execution state machine. Walks the steps of a ParsedSkill, dispatching each
//! step to a channel and emitting events (`execution:step_started`, etc.) back
//! to the frontend.

use crate::orchestrator::skill_parser::ParsedSkill;
use crate::orchestrator::state::ExecutionState;

pub struct Executor {
    pub state: ExecutionState,
}

impl Executor {
    pub fn new() -> Self {
        Self {
            state: ExecutionState::Idle,
        }
    }

    pub async fn run(&mut self, _skill: ParsedSkill) -> Result<(), String> {
        // TODO: iterate steps, dispatch to channels, emit Tauri events
        Ok(())
    }

    pub fn abort(&mut self) {
        self.state = ExecutionState::Aborted;
    }

    pub fn pause(&mut self) {
        self.state = ExecutionState::Paused;
    }

    pub fn resume(&mut self) {
        if matches!(self.state, ExecutionState::Paused) {
            self.state = ExecutionState::Running;
        }
    }
}

impl Default for Executor {
    fn default() -> Self {
        Self::new()
    }
}
