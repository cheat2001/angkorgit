use base64::Engine;

use crate::core::accounts;
use crate::error::{AppError, AppResult};
use crate::http::{HttpRequest, HttpResponse};

fn normalize(host: &str) -> String {
    host.trim().trim_end_matches('/').to_lowercase()
}

fn url_host_allowed(host: &str, url_host: &str) -> bool {
    let host = normalize(host);
    let url_host = normalize(url_host);
    url_host == host || url_host == format!("api.{host}")
}

fn auth_headers(
    provider: &str,
    token: &str,
    email: Option<&str>,
) -> AppResult<Vec<(String, String)>> {
    let mut headers = vec![("user-agent".to_string(), "AngKorGit".to_string())];
    match provider {
        "github" => {
            headers.push(("authorization".to_string(), format!("Bearer {token}")));
            headers.push((
                "accept".to_string(),
                "application/vnd.github+json".to_string(),
            ));
            headers.push(("x-github-api-version".to_string(), "2022-11-28".to_string()));
        }
        "gitlab" | "gitlab-self" => {
            headers.push(("private-token".to_string(), token.to_string()));
        }
        "bitbucket" => {
            let email = email.ok_or_else(|| {
                AppError::other(
                    "the Bitbucket account has no Atlassian email stored — reconnect it in \
                     Settings → Authentication",
                )
            })?;
            let basic =
                base64::engine::general_purpose::STANDARD.encode(format!("{email}:{token}"));
            headers.push(("authorization".to_string(), format!("Basic {basic}")));
        }
        other => {
            return Err(AppError::other(format!(
                "unsupported hosting provider '{other}'"
            )));
        }
    }
    Ok(headers)
}

fn bound_username(repo_path: Option<&str>, host: &str) -> Option<String> {
    let repo = crate::core::repo::open(repo_path?).ok()?;
    let raw = repo.config().ok()?.get_string("angkorgit.accounts").ok()?;
    crate::core::remote::parse_account_bindings(&raw)
        .get(&normalize(host))
        .cloned()
}

pub async fn request(
    repo_path: Option<String>,
    host: String,
    mut request: HttpRequest,
) -> AppResult<HttpResponse> {
    let url_host = accounts::host_of_url(&request.url)
        .ok_or_else(|| AppError::other("forge requests need an absolute http(s) URL"))?;
    if !url_host_allowed(&host, &url_host) {
        return Err(AppError::other(format!(
            "forge request to {url_host} does not match the remote host {host}"
        )));
    }

    let headers = tauri::async_runtime::spawn_blocking({
        let host = host.clone();
        move || -> AppResult<Vec<(String, String)>> {
            let preferred = bound_username(repo_path.as_deref(), &host);
            let (username, token) = accounts::candidates(&host, preferred.as_deref())
                .into_iter()
                .next()
                .ok_or_else(|| {
                    AppError::other(format!(
                        "no connected {host} account — connect one in Settings → Authentication"
                    ))
                })?;
            let account = accounts::find(&host, &username).ok_or_else(|| {
                AppError::other(format!("no account metadata for {username} on {host}"))
            })?;
            auth_headers(&account.provider, &token, account.email.as_deref())
        }
    })
    .await
    .map_err(|e| AppError::other(e.to_string()))??;

    for (name, value) in headers {
        request.headers.insert(name, value);
    }
    crate::http::request(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_com_requests_may_target_the_api_subdomain() {
        assert!(url_host_allowed("github.com", "api.github.com"));
        assert!(url_host_allowed("github.com", "github.com"));
        assert!(!url_host_allowed("github.com", "evilgithub.com"));
        assert!(!url_host_allowed("github.com", "api.github.com.evil.dev"));
    }

    #[test]
    fn enterprise_requests_stay_on_the_remote_host() {
        assert!(url_host_allowed(
            "github.corp.dev:8443",
            "github.corp.dev:8443"
        ));
        assert!(!url_host_allowed("github.corp.dev", "github.com"));
    }

    #[test]
    fn github_auth_uses_a_bearer_token_and_api_version() {
        let headers = auth_headers("github", "tok", None).unwrap();
        assert!(headers.contains(&("authorization".to_string(), "Bearer tok".to_string())));
        assert!(headers
            .iter()
            .any(|(name, _)| name == "x-github-api-version"));
        assert!(headers.contains(&("user-agent".to_string(), "AngKorGit".to_string())));
    }

    #[test]
    fn gitlab_auth_uses_the_private_token_header() {
        let headers = auth_headers("gitlab-self", "tok", None).unwrap();
        assert!(headers.contains(&("private-token".to_string(), "tok".to_string())));
    }

    #[test]
    fn bitbucket_auth_requires_the_stored_email() {
        assert!(auth_headers("bitbucket", "tok", None).is_err());
        let headers = auth_headers("bitbucket", "tok", Some("dev@example.com")).unwrap();
        let basic = base64::engine::general_purpose::STANDARD.encode("dev@example.com:tok");
        assert!(headers.contains(&("authorization".to_string(), format!("Basic {basic}"))));
    }

    #[test]
    fn unknown_providers_are_rejected() {
        assert!(auth_headers("sourcehut", "tok", None).is_err());
    }
}
