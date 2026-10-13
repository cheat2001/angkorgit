use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::types::{GroupUpdateReceipt, GroupUpdateResult};
use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct GroupUpdateControl {
    cancelled: Mutex<bool>,
    completed: Mutex<HashMap<String, GroupUpdateResult>>,
}

impl GroupUpdateControl {
    pub fn cancel(&self) -> AppResult<()> {
        *self
            .cancelled
            .lock()
            .map_err(|_| AppError::other("Group update lock poisoned"))? = true;
        Ok(())
    }

    pub fn cancel_results(&self) -> AppResult<Vec<GroupUpdateReceipt>> {
        self.cancel()?;
        let completed = self
            .completed
            .lock()
            .map_err(|_| AppError::other("Group results lock poisoned"))?;
        Ok(completed
            .iter()
            .map(|(path, result)| GroupUpdateReceipt {
                path: path.clone(),
                result: result.clone(),
            })
            .collect())
    }

    pub fn with_active_result(
        &self,
        path: &str,
        action: impl FnOnce() -> AppResult<GroupUpdateResult>,
    ) -> AppResult<GroupUpdateResult> {
        self.with_active(|| {
            let result = action();
            let receipt = match &result {
                Ok(result) => result.clone(),
                Err(error) => GroupUpdateResult {
                    status: "failed".into(),
                    message: error.to_string(),
                    changes: Vec::new(),
                },
            };
            self.completed
                .lock()
                .map_err(|_| AppError::other("Group results lock poisoned"))?
                .insert(path.into(), receipt);
            result
        })
    }

    pub fn has_completed(&self, path: &str) -> bool {
        self.completed
            .lock()
            .map(|completed| completed.contains_key(path))
            .unwrap_or(false)
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

struct Run {
    control: Arc<GroupUpdateControl>,
    last_used: Instant,
}

type Runs = HashMap<String, Run>;
static RUNS: OnceLock<Mutex<Runs>> = OnceLock::new();
const RUN_TTL: Duration = Duration::from_secs(60 * 60);

fn runs() -> &'static Mutex<Runs> {
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_expired(runs: &mut Runs, now: Instant) {
    runs.retain(|_, run| {
        if now.saturating_duration_since(run.last_used) < RUN_TTL {
            return true;
        }
        match run.control.cancelled.try_lock() {
            Ok(mut cancelled) => {
                *cancelled = true;
                false
            }
            Err(std::sync::TryLockError::WouldBlock) => true,
            Err(std::sync::TryLockError::Poisoned(_)) => false,
        }
    });
}

pub fn start(id: &str) -> AppResult<()> {
    let mut runs = runs()
        .lock()
        .map_err(|_| AppError::other("Group update registry poisoned"))?;
    let now = Instant::now();
    prune_expired(&mut runs, now);
    if runs.contains_key(id) {
        return Err(AppError::other("Group update already exists"));
    }
    runs.insert(
        id.into(),
        Run {
            control: Arc::new(GroupUpdateControl::default()),
            last_used: now,
        },
    );
    Ok(())
}

pub fn control(id: &str) -> AppResult<Arc<GroupUpdateControl>> {
    let mut runs = runs()
        .lock()
        .map_err(|_| AppError::other("Group update registry poisoned"))?;
    let now = Instant::now();
    let control = runs.get_mut(id).map(|run| {
        run.last_used = now;
        run.control.clone()
    });
    prune_expired(&mut runs, now);
    control.ok_or_else(|| AppError::other("Group update is no longer active"))
}

pub fn cancel(id: &str) -> AppResult<Vec<GroupUpdateReceipt>> {
    let mut runs = runs()
        .lock()
        .map_err(|_| AppError::other("Group update registry poisoned"))?;
    let now = Instant::now();
    let control = runs.get_mut(id).map(|run| {
        run.last_used = now;
        run.control.clone()
    });
    prune_expired(&mut runs, now);
    drop(runs);
    match control {
        Some(control) => control.cancel_results(),
        None => Ok(Vec::new()),
    }
}

pub fn finish(id: &str) -> AppResult<()> {
    let mut runs = runs()
        .lock()
        .map_err(|_| AppError::other("Group update registry poisoned"))?;
    let control = runs.remove(id).map(|run| run.control);
    prune_expired(&mut runs, Instant::now());
    drop(runs);
    if let Some(control) = control {
        control.cancel()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_runs_are_removed_and_cancel_their_in_flight_downloads() {
        let now = Instant::now();
        let control = Arc::new(GroupUpdateControl::default());
        let mut runs = HashMap::from([(
            "stale".into(),
            Run {
                control: control.clone(),
                last_used: now - RUN_TTL,
            },
        )]);
        prune_expired(&mut runs, now);
        assert!(runs.is_empty());
        assert!(control.is_cancelled());
        assert!(control
            .with_active::<()>(|| panic!("expired run cannot mutate"))
            .is_err());
    }

    #[test]
    fn expiry_never_blocks_or_interrupts_an_active_checkout() {
        let now = Instant::now();
        let control = Arc::new(GroupUpdateControl::default());
        let mut runs = HashMap::from([(
            "active".into(),
            Run {
                control: control.clone(),
                last_used: now - RUN_TTL,
            },
        )]);
        let guard = control.cancelled.lock().unwrap();
        prune_expired(&mut runs, now);
        assert_eq!(runs.len(), 1);
        assert!(!*guard);
        drop(guard);
        prune_expired(&mut runs, now);
        assert!(runs.is_empty());
        assert!(control.is_cancelled());
    }
}
