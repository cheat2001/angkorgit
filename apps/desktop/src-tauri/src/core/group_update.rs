use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct GroupUpdateControl {
    cancelled: Mutex<bool>,
}

impl GroupUpdateControl {
    pub fn cancel(&self) -> AppResult<()> {
        *self
            .cancelled
            .lock()
            .map_err(|_| AppError::other("Group update lock poisoned"))? = true;
        Ok(())
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled
            .lock()
            .map(|cancelled| *cancelled)
            .unwrap_or(true)
    }

    pub fn with_active<T>(&self, action: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
        let cancelled = self
            .cancelled
            .lock()
            .map_err(|_| AppError::other("Group update lock poisoned"))?;
        if *cancelled {
            return Err(AppError::other("Group update cancelled"));
        }
        action()
    }
}

type Runs = HashMap<String, Arc<GroupUpdateControl>>;
static RUNS: OnceLock<Mutex<Runs>> = OnceLock::new();

fn runs() -> &'static Mutex<Runs> {
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn start(id: &str) -> AppResult<()> {
    let mut runs = runs()
        .lock()
        .map_err(|_| AppError::other("Group update registry poisoned"))?;
    if runs.contains_key(id) {
        return Err(AppError::other("Group update already exists"));
    }
    runs.insert(id.into(), Arc::new(GroupUpdateControl::default()));
    Ok(())
}

pub fn control(id: &str) -> AppResult<Arc<GroupUpdateControl>> {
    runs()
        .lock()
        .map_err(|_| AppError::other("Group update registry poisoned"))?
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::other("Group update is no longer active"))
}

pub fn cancel(id: &str) -> AppResult<()> {
    control(id)?.cancel()
}

pub fn finish(id: &str) -> AppResult<()> {
    let control = runs()
        .lock()
        .map_err(|_| AppError::other("Group update registry poisoned"))?
        .remove(id);
    if let Some(control) = control {
        control.cancel()?;
    }
    Ok(())
}
