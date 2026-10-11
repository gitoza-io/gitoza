//! Host-injected persistence for confirm workflow steps and push-failed markers.
//!
//! Sync (not async): matches Gitoza's existing rusqlite helpers.

use anyhow::Result;

use crate::types::WorkflowStep;

pub trait WorkflowStore: Send + Sync {
    fn get_step(&self) -> Result<Option<WorkflowStep>>;
    fn set_step(&self, step: WorkflowStep, branch: &str) -> Result<()>;
    fn clear(&self) -> Result<()>;
}

pub trait PushFailedStore: Send + Sync {
    fn mark(&self, reason: &str) -> Result<()>;
    fn clear(&self) -> Result<()>;
}

/// In-memory stores for unit tests.
#[derive(Default)]
pub struct MemoryWorkflowStore {
    pub step: std::sync::Mutex<Option<(WorkflowStep, String)>>,
}

impl WorkflowStore for MemoryWorkflowStore {
    fn get_step(&self) -> Result<Option<WorkflowStep>> {
        Ok(self.step.lock().unwrap().as_ref().map(|(s, _)| *s))
    }

    fn set_step(&self, step: WorkflowStep, branch: &str) -> Result<()> {
        *self.step.lock().unwrap() = Some((step, branch.to_string()));
        Ok(())
    }

    fn clear(&self) -> Result<()> {
        *self.step.lock().unwrap() = None;
        Ok(())
    }
}

#[derive(Default)]
pub struct MemoryPushFailedStore {
    pub reason: std::sync::Mutex<Option<String>>,
}

impl PushFailedStore for MemoryPushFailedStore {
    fn mark(&self, reason: &str) -> Result<()> {
        *self.reason.lock().unwrap() = Some(reason.to_string());
        Ok(())
    }

    fn clear(&self) -> Result<()> {
        *self.reason.lock().unwrap() = None;
        Ok(())
    }
}
