//! Orchestration layer: parses skills, resolves variables, executes steps, validates.

pub mod executor;
pub mod skill_parser;
pub mod state;
pub mod validator;
pub mod variable_resolver;

pub use skill_parser::{ParsedSkill, SkillConfig, SkillMeta, SkillStep, StepLoop};
pub use state::{ExecutionState, StepState};
