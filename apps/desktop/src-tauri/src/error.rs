use serde::Serialize;

/// Unified error crossing the IPC boundary. The frontend receives
/// `{ code, message }` and maps codes to user-facing recovery actions.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Git(#[from] git2::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
    #[error("no repository is open")]
    NoRepository,
    #[error("operation would conflict: {0}")]
    Conflict(String),
}

impl AppError {
    pub fn other(message: impl Into<String>) -> Self {
        AppError::Other(message.into())
    }

    fn code(&self) -> &'static str {
        match self {
            AppError::Git(e) => match e.code() {
                git2::ErrorCode::Conflict => "conflict",
                git2::ErrorCode::Auth => "auth",
                git2::ErrorCode::NotFound => "not_found",
                git2::ErrorCode::Exists => "exists",
                git2::ErrorCode::NotFastForward => "non_fast_forward",
                git2::ErrorCode::Unmerged | git2::ErrorCode::MergeConflict => "conflict",
                _ => "git",
            },
            AppError::Io(_) => "io",
            AppError::Other(_) => "other",
            AppError::NoRepository => "no_repository",
            AppError::Conflict(_) => "conflict",
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
