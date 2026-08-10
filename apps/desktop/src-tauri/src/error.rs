use serde::Serialize;

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

const HTTP_STATUS_MARKER: &str = "unexpected http status code: ";

impl AppError {
    pub fn other(message: impl Into<String>) -> Self {
        AppError::Other(message.into())
    }

    fn http_status(&self) -> Option<u16> {
        let AppError::Git(error) = self else {
            return None;
        };
        let rest = error
            .message()
            .split(HTTP_STATUS_MARKER)
            .nth(1)?
            .to_string();
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        digits.parse().ok()
    }

    fn message(&self) -> String {
        match self.http_status() {
            Some(402) => "HTTP 402 — the host refused the write because the account or workspace \
                          is over its plan limit or has a billing problem. On Bitbucket Cloud a \
                          free workspace over its user limit turns every private repository \
                          read-only; public repositories still accept pushes."
                .to_string(),
            Some(403) => "HTTP 403 — the host accepted your identity but refused the operation. \
                          The token is usually missing a write scope, or the account has no \
                          write access to this repository."
                .to_string(),
            _ => self.to_string(),
        }
    }

    fn code(&self) -> &'static str {
        if let Some(status) = self.http_status() {
            return match status {
                402 => "plan_limit",
                403 => "forbidden",
                _ => "git",
            };
        }
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
            message: self.message(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    fn git_error(message: &str) -> AppError {
        AppError::Git(git2::Error::from_str(message))
    }

    #[test]
    fn extracts_http_status_from_libgit2_message() {
        assert_eq!(
            git_error("unexpected http status code: 402").http_status(),
            Some(402)
        );
        assert_eq!(
            git_error("unexpected http status code: 403; class=Http (34)").http_status(),
            Some(403)
        );
    }

    #[test]
    fn plain_git_errors_have_no_http_status() {
        assert_eq!(git_error("reference not found").http_status(), None);
        assert_eq!(AppError::NoRepository.http_status(), None);
    }

    #[test]
    fn plan_limit_errors_are_explained() {
        let error = git_error("unexpected http status code: 402");
        assert_eq!(error.code(), "plan_limit");
        assert!(error.message().contains("plan limit"));
        assert!(!error.message().contains("class=Http"));
    }

    #[test]
    fn unmapped_status_codes_keep_the_original_message() {
        let error = git_error("unexpected http status code: 500");
        assert_eq!(error.code(), "git");
        assert!(error.message().contains("500"));
    }
}
