//! Orchestration layer: parses skills, resolves variables, executes steps, validates.

pub mod executor;
pub mod skill_parser;
pub mod state;
pub mod validator;
pub mod variable_resolver;
pub mod workflow_executor;
pub mod workflow_parser;

pub use executor::{ExecutionHandle, ExecutionRegistry, Executor};
pub use skill_parser::{ParsedSkill, SkillConfig, SkillMeta, SkillStep, StepLoop};
pub use state::{ExecutionState, StepState};
pub use validator::StepResult;
pub use workflow_executor::WorkflowExecutor;
pub use workflow_parser::{parse_workflow, ParsedWorkflow, WorkflowMeta, WorkflowStep};
