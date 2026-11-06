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
    #[error("The {hook} hook failed (exit code {status}).")]
    Hook {
        hook: String,
        status: i32,
        output: String,
    },
    #[error(
        "The {hook} hook did not finish within {seconds} seconds{}",
        if *.exit_unconfirmed {
            ". Windows could not confirm that all hook processes exited."
        } else {
            " and was stopped."
        }
    )]
    HookTimeout {
        hook: String,
        seconds: u64,
        exit_unconfirmed: bool,
        output: String,
    },
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

    fn is_non_fast_forward(&self) -> bool {
        matches!(self, AppError::Git(error) if error.code() == git2::ErrorCode::NotFastForward)
    }

    fn message(&self) -> String {
        if self.is_non_fast_forward() {
            return "The remote has commits this branch does not have yet. Pull with rebase to \
                    bring them in first, or force push if you rewrote commits that were already \
                    pushed (amend or rebase)."
                .to_string();
        }
        match self.http_status() {
            Some(401) => "HTTP 401 — the host rejected the credentials. If this remote uses a \
                          connected account, its token may have expired or been revoked — \
                          reconnect it in Settings → Authentication."
                .to_string(),
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
                401 => "auth",
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
            AppError::Io(e) => match e.kind() {
                std::io::ErrorKind::NotFound => "not_found",
                _ => "io",
            },
            AppError::Other(_) => "other",
            AppError::NoRepository => "no_repository",
            AppError::Conflict(_) => "conflict",
            AppError::Hook { .. } => "hook_failed",
            AppError::HookTimeout { .. } => "hook_timeout",
        }
    }

    fn detail(&self) -> Option<String> {
        match self {
            AppError::Hook { output, .. } | AppError::HookTimeout { output, .. }
                if !output.is_empty() =>
            {
                Some(output.clone())
            }
            _ => None,
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'a str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ErrorPayload {
            code: self.code(),
            message: self.message(),
            detail: self.detail(),
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
    fn non_fast_forward_pushes_get_a_next_step_instead_of_the_libgit2_text() {
        let error = AppError::Git(git2::Error::new(
            git2::ErrorCode::NotFastForward,
            git2::ErrorClass::Reference,
            "cannot push non-fastforwardable reference",
        ));
        assert_eq!(error.code(), "non_fast_forward");
        assert!(error.message().contains("Pull with rebase"));
        assert!(error.message().contains("force push"));
        assert!(!error.message().contains("non-fastforwardable"));
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

    #[test]
    fn missing_files_map_to_not_found_and_other_io_errors_stay_io() {
        let missing = AppError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "no file"));
        assert_eq!(missing.code(), "not_found");
        let denied = AppError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "denied",
        ));
        assert_eq!(denied.code(), "io");
    }

    #[test]
    fn hook_failures_carry_the_hook_output_as_detail() {
        let error = AppError::Hook {
            hook: "pre-commit".into(),
            status: 3,
            output: "lint: bad file".into(),
        };
        let payload = serde_json::to_value(&error).unwrap();
        assert_eq!(payload["code"], "hook_failed");
        assert_eq!(
            payload["message"],
            "The pre-commit hook failed (exit code 3)."
        );
        assert_eq!(payload["detail"], "lint: bad file");
        let plain = serde_json::to_value(AppError::other("boom")).unwrap();
        assert!(plain.get("detail").is_none());
    }

    #[test]
    fn a_hook_timeout_reports_an_unconfirmed_exit_and_keeps_its_output() {
        let error = AppError::HookTimeout {
            hook: "post-merge".into(),
            seconds: 600,
            exit_unconfirmed: true,
            output: "installing".into(),
        };
        let payload = serde_json::to_value(&error).unwrap();
        assert_eq!(payload["code"], "hook_timeout");
        assert_eq!(
            payload["message"],
            "The post-merge hook did not finish within 600 seconds. Windows could not confirm that all hook processes exited."
        );
        assert_eq!(payload["detail"], "installing");
    }

    #[test]
    fn unauthorized_errors_hint_at_token_expiry() {
        let error = git_error("unexpected http status code: 401");
        assert_eq!(error.code(), "auth");
        assert!(error.message().contains("expired"));
        assert!(error.message().contains("Settings → Authentication"));
    }
}
