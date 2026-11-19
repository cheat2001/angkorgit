use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{Client, StatusCode, Url};

use crate::core::accounts::{https_account_origin, AccountInfo};
use crate::error::{AppError, AppResult};
use crate::http::{self, HttpRequest, HttpResponse};

fn api_base(account: &AccountInfo) -> AppResult<Url> {
    let origin = https_account_origin(&account.host)
        .ok_or_else(|| AppError::other("The saved account has an invalid host."))?;
    let base = match account.provider.as_str() {
        "github" if origin.as_str() == "https://github.com/" => {
            Url::parse("https://api.github.com/")
        }
        "github" => origin.join("api/v3/"),
        "gitlab" | "gitlab-self" => origin.join("api/v4/"),
        "bitbucket" if origin.as_str() == "https://bitbucket.org/" => {
            Url::parse("https://api.bitbucket.org/2.0/")
        }
        _ => {
            return Err(AppError::other(
                "Repository browsing is unavailable for this account.",
            ))
        }
    };
    Ok(base.expect("forge API paths are fixed"))
}

fn request_url(base: &Url, url: &str) -> AppResult<Url> {
    Url::parse(url)
        .ok()
        .filter(|url| {
            url.origin() == base.origin()
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
                && url.path().starts_with(base.path())
        })
        .ok_or_else(|| AppError::other("The request does not match the saved account's HTTPS API."))
}

fn client() -> AppResult<&'static Client> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = Client::builder()
        .timeout(Duration::from_secs(10))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::other("Could not start the repository browser."))?;
    Ok(CLIENT.get_or_init(|| built))
}

pub async fn request(account: &AccountInfo, token: &str, url: String) -> AppResult<HttpResponse> {
    let url = request_url(&api_base(account)?, &url)?;
    let headers = crate::forge::auth_headers(&account.provider, token, account.email.as_deref())?;
    http::request_with_client(
        client()?,
        HttpRequest {
            url: url.into(),
            method: "GET".into(),
            headers: headers.into_iter().collect(),
            body: None,
        },
    )
    .await
}

pub async fn account_token_rejected(account: &AccountInfo, token: &str) -> bool {
    let Ok(base) = api_base(account) else {
        return false;
    };
    let url = base
        .join("user")
        .expect("account identity endpoint is fixed");
    request(account, token, url.into())
        .await
        .is_ok_and(|response| response.status == StatusCode::UNAUTHORIZED.as_u16())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(provider: &str, host: &str) -> AccountInfo {
        AccountInfo {
            host: host.into(),
            username: "work".into(),
            provider: provider.into(),
            verified: true,
            email: None,
            verified_at: None,
            expires_at: None,
            is_default: true,
        }
    }

    #[test]
    fn saved_account_requests_are_pinned_to_the_https_api_origin_and_prefix() {
        let base = api_base(&account("gitlab-self", "git.example.test:8443")).unwrap();
        assert!(request_url(&base, "https://git.example.test:8443/api/v4/projects").is_ok());
        for url in [
            "http://git.example.test:8443/api/v4/projects",
            "https://git.example.test/api/v4/projects",
            "https://wrong.example.test:8443/api/v4/projects",
            "https://git.example.test:8443/api/v4x/projects",
            "https://user@git.example.test:8443/api/v4/projects",
        ] {
            assert!(request_url(&base, url).is_err(), "{url}");
        }
    }

    #[test]
    fn public_forge_requests_use_the_official_api_origins() {
        for (provider, host, expected) in [
            ("github", "github.com", "https://api.github.com/user"),
            (
                "github",
                "github.corp.test",
                "https://github.corp.test/api/v3/user",
            ),
            (
                "bitbucket",
                "bitbucket.org",
                "https://api.bitbucket.org/2.0/user",
            ),
        ] {
            let base = api_base(&account(provider, host)).unwrap();
            assert_eq!(base.join("user").unwrap().as_str(), expected);
        }
    }

    #[test]
    fn authenticated_repository_client_rejects_plain_http() {
        let result = tauri::async_runtime::block_on(
            client().unwrap().get("http://127.0.0.1:1/projects").send(),
        );
        assert!(matches!(result, Err(error) if error.is_builder()));
    }
}
