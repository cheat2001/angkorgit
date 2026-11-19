use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, LINK};
use reqwest::{Client, Response, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::core::accounts::{account_origin, clone_url, AccountInfo};
use crate::error::{AppError, AppResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepository {
    full_name: String,
    clone_url: String,
}

#[derive(Deserialize)]
struct GitHubRepository {
    full_name: String,
    clone_url: String,
}

#[derive(Deserialize)]
struct GitLabProject {
    path_with_namespace: String,
    http_url_to_repo: String,
}

#[derive(Deserialize)]
struct BitbucketPage<T> {
    values: Vec<T>,
    next: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceAccess {
    workspace: Workspace,
}

#[derive(Deserialize)]
struct Workspace {
    slug: String,
}

#[derive(Deserialize)]
struct RepositoryPermission {
    repository: BitbucketRepository,
}

#[derive(Deserialize)]
struct BitbucketRepository {
    full_name: String,
}

struct Api {
    client: &'static Client,
    headers: HeaderMap,
    label: &'static str,
    scopes: &'static str,
}

impl Api {
    fn new(account: &AccountInfo, token: &str) -> AppResult<Self> {
        static CLIENT: OnceLock<Client> = OnceLock::new();
        let client = match CLIENT.get() {
            Some(client) => client,
            None => {
                let client = Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(30))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(|_| AppError::other("Could not start the repository browser."))?;
                CLIENT.get_or_init(|| client)
            }
        };
        let (label, scopes) = match account.provider.as_str() {
            "github" => (
                "GitHub",
                "Metadata and Contents read access for the repositories you want to clone",
            ),
            "gitlab" | "gitlab-self" => ("GitLab", "read_api (or api) and repository read access"),
            "bitbucket" => (
                "Bitbucket",
                "read:workspace:bitbucket and read:repository:bitbucket",
            ),
            _ => {
                return Err(AppError::other(
                    "Repository browsing is unavailable for this provider.",
                ))
            }
        };
        let mut headers = HeaderMap::new();
        for (name, value) in
            crate::forge::auth_headers(&account.provider, token, account.email.as_deref())?
        {
            let mut value = HeaderValue::from_str(&value)
                .map_err(|_| AppError::other("The saved account has invalid credentials."))?;
            value.set_sensitive(true);
            headers.insert(
                reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .expect("forge header names are fixed"),
                value,
            );
        }
        Ok(Self {
            client,
            headers,
            label,
            scopes,
        })
    }

    async fn send(&self, url: Url) -> Result<Response, reqwest::Error> {
        self.client
            .get(url)
            .headers(self.headers.clone())
            .send()
            .await
    }

    async fn get(&self, url: Url) -> AppResult<Response> {
        self.send(url).await.map_err(|_| self.connection_error())
    }

    fn connection_error(&self) -> AppError {
        AppError::other(format!(
            "Could not reach {}. Check your connection and try again.",
            self.label
        ))
    }

    async fn decode<T: DeserializeOwned>(&self, response: Response) -> AppResult<T> {
        let status = response.status();
        if !status.is_success() {
            let message = match status {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => format!(
                    "{} refused repository access ({status}). Reconnect the account in Settings → Authentication with {}.",
                    self.label, self.scopes
                ),
                StatusCode::TOO_MANY_REQUESTS => format!("{} is rate limiting requests. Try again later.", self.label),
                _ => format!("{} could not list repositories ({status}).", self.label),
            };
            return Err(AppError::other(message));
        }
        response.json().await.map_err(|_| {
            AppError::other(format!(
                "{} returned an invalid repository list.",
                self.label
            ))
        })
    }

    async fn link_pages<T: DeserializeOwned>(&self, first: Response) -> AppResult<Vec<T>> {
        let mut response = first;
        let mut entries = Vec::new();
        let mut visited = HashSet::new();
        loop {
            let page = response.url().clone();
            visited.insert(page.clone());
            let next = next_link(response.headers(), &page);
            entries.extend(self.decode::<Vec<T>>(response).await?);
            let Some(next) = next else { return Ok(entries) };
            response = self.get(next_page(&page, &next, &visited)?).await?;
        }
    }

    async fn bitbucket_pages<T: DeserializeOwned>(&self, mut page: Url) -> AppResult<Vec<T>> {
        let mut entries = Vec::new();
        let mut visited = HashSet::new();
        loop {
            visited.insert(page.clone());
            let result: BitbucketPage<T> = self.decode(self.get(page.clone()).await?).await?;
            entries.extend(result.values);
            let Some(next) = result.next else {
                return Ok(entries);
            };
            page = next_page(&page, &next, &visited)?;
        }
    }
}

fn next_link(headers: &HeaderMap, page: &Url) -> Option<String> {
    headers
        .get_all(LINK)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|value| value.trim().strip_prefix('<')?.split_once('>'))
        .find(|(_, params)| params.split(';').any(|part| part.trim() == "rel=\"next\""))
        .map(|(url, _)| url.to_string())
        .or_else(|| {
            let next = headers
                .get("x-next-page")?
                .to_str()
                .ok()?
                .parse::<u32>()
                .ok()?;
            if next == 0 {
                return None;
            }
            let mut url = page.clone();
            url.set_query(None);
            url.query_pairs_mut()
                .extend_pairs(page.query_pairs().filter(|(key, _)| key != "page"))
                .append_pair("page", &next.to_string());
            Some(url.into())
        })
}

fn next_page(page: &Url, next: &str, visited: &HashSet<Url>) -> AppResult<Url> {
    page.join(next)
        .ok()
        .filter(|url| {
            url.origin() == page.origin()
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
                && !visited.contains(url)
        })
        .ok_or_else(|| {
            AppError::other("The provider returned an invalid repository pagination link.")
        })
}

fn account_base(account: &AccountInfo, scheme: &str) -> AppResult<Url> {
    account_origin(&account.host, scheme)
        .ok_or_else(|| AppError::other("The saved account has an invalid host."))
}

fn provider_url(base: &Url, path: &str) -> Url {
    base.join(path).expect("provider API paths are fixed")
}

async fn github(api: &Api, account: &AccountInfo) -> AppResult<Vec<(String, String)>> {
    let page = if account.host == "github.com" {
        Url::parse("https://api.github.com/user/repos?per_page=100").unwrap()
    } else {
        provider_url(
            &account_base(account, "https")?,
            "api/v3/user/repos?per_page=100",
        )
    };
    let entries = api
        .link_pages::<GitHubRepository>(api.get(page).await?)
        .await?;
    Ok(entries
        .into_iter()
        .map(|entry| (entry.full_name, entry.clone_url))
        .collect())
}

async fn gitlab(api: &Api, account: &AccountInfo) -> AppResult<Vec<(String, String)>> {
    let projects = "api/v4/projects?membership=true&simple=true&per_page=100&order_by=id&sort=asc";
    let page = provider_url(&account_base(account, "https")?, projects);
    let response = match api.send(page).await {
        Ok(response) => response,
        Err(error) if account.provider == "gitlab-self" && error.is_connect() => {
            api.get(provider_url(&account_base(account, "http")?, projects))
                .await?
        }
        Err(_) => return Err(api.connection_error()),
    };
    let entries = api.link_pages::<GitLabProject>(response).await?;
    Ok(entries
        .into_iter()
        .map(|entry| (entry.path_with_namespace, entry.http_url_to_repo))
        .collect())
}

async fn bitbucket(api: &Api) -> AppResult<Vec<(String, String)>> {
    let root = Url::parse("https://api.bitbucket.org/2.0/user/workspaces").unwrap();
    let workspaces = api.bitbucket_pages::<WorkspaceAccess>(root.clone()).await?;
    let mut repos = Vec::new();
    for entry in workspaces {
        let mut page = root.clone();
        page.path_segments_mut().unwrap().extend([
            entry.workspace.slug.as_str(),
            "permissions",
            "repositories",
        ]);
        let permissions = api.bitbucket_pages::<RepositoryPermission>(page).await?;
        repos.extend(permissions.into_iter().filter_map(|entry| {
            let full_name = entry.repository.full_name;
            let (workspace, slug) = full_name.split_once('/')?;
            if workspace.is_empty() || slug.is_empty() || slug.contains('/') {
                return None;
            }
            let mut clone_url = Url::parse("https://bitbucket.org").unwrap();
            clone_url
                .path_segments_mut()
                .unwrap()
                .extend([workspace, &format!("{slug}.git")]);
            Some((full_name, clone_url.into()))
        }));
    }
    Ok(repos)
}

pub async fn list(account: AccountInfo, token: &str) -> AppResult<Vec<RemoteRepository>> {
    let api = Api::new(&account, token)?;
    let entries = match account.provider.as_str() {
        "github" => github(&api, &account).await?,
        "gitlab" | "gitlab-self" => gitlab(&api, &account).await?,
        "bitbucket" => bitbucket(&api).await?,
        _ => unreachable!("API construction checks supported providers"),
    };
    let mut seen = HashSet::new();
    let mut repositories: Vec<_> = entries
        .into_iter()
        .filter_map(|(full_name, url)| {
            let url: String = clone_url(&account, &url)?.into();
            (!full_name.is_empty() && seen.insert(url.clone())).then_some(RemoteRepository {
                full_name,
                clone_url: url,
            })
        })
        .collect();
    repositories.sort_by_cached_key(|repo| repo.full_name.to_lowercase());
    Ok(repositories)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    fn serve_pages(pages: &[(&'static str, &'static str, &'static str)]) -> Url {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let pages = pages.to_vec();
        std::thread::spawn(move || {
            for (path, headers, body) in pages {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let request: Vec<_> = BufReader::new(&stream)
                    .lines()
                    .map(Result::unwrap)
                    .take_while(|line| !line.is_empty())
                    .collect();
                assert_eq!(request.first().unwrap(), &format!("GET {path} HTTP/1.1"));
                write!(stream, "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json\r\n{headers}Content-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        origin
    }

    fn test_api() -> Api {
        static CLIENT: OnceLock<Client> = OnceLock::new();
        Api {
            client: CLIENT.get_or_init(|| {
                Client::builder()
                    .timeout(Duration::from_secs(5))
                    .build()
                    .unwrap()
            }),
            headers: HeaderMap::new(),
            label: "Test provider",
            scopes: "read access",
        }
    }

    #[test]
    fn github_and_gitlab_pagination_reads_link_and_next_page_headers() {
        let origin = serve_pages(&[
            (
                "/projects?membership=true",
                "Link: </projects?membership=true&page=2>; rel=\"next\"\r\n",
                "[1]",
            ),
            (
                "/projects?membership=true&page=2",
                "X-Next-Page: 3\r\n",
                "[2]",
            ),
            (
                "/projects?membership=true&page=3",
                "Link: </projects?membership=true&page=2>; rel=\"prev\"\r\n",
                "[3]",
            ),
        ]);
        let api = test_api();
        let results = tauri::async_runtime::block_on(async {
            let response = api
                .get(origin.join("/projects?membership=true").unwrap())
                .await
                .unwrap();
            api.link_pages::<u32>(response).await.unwrap()
        });
        assert_eq!(results, vec![1, 2, 3]);
    }

    #[test]
    fn bitbucket_pagination_follows_next_urls_in_the_response_body() {
        let origin = serve_pages(&[
            (
                "/workspaces",
                "",
                r#"{"values":[1],"next":"/workspaces?page=2"}"#,
            ),
            ("/workspaces?page=2", "", r#"{"values":[2]}"#),
        ]);
        let results = tauri::async_runtime::block_on(
            test_api().bitbucket_pages::<u32>(origin.join("/workspaces").unwrap()),
        )
        .unwrap();
        assert_eq!(results, vec![1, 2]);
    }

    #[test]
    fn pagination_rejects_other_origins_userinfo_and_cycles() {
        let page = Url::parse("https://git.example.com:8443/api/v4/projects?page=1").unwrap();
        let visited = HashSet::from([page.clone()]);
        for url in [
            "https://git.example.com:443/api/v4/projects?page=2",
            "https://elsewhere.test/api/v4/projects?page=2",
            "http://git.example.com:8443/api/v4/projects?page=2",
            "https://user@git.example.com:8443/api/v4/projects?page=2",
            "?page=1",
        ] {
            assert!(next_page(&page, url, &visited).is_err(), "{url}");
        }
        assert_eq!(
            next_page(&page, "?page=2", &visited).unwrap().query(),
            Some("page=2")
        );
    }
}
