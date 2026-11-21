use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub headers: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_page: Option<String>,
}

pub(crate) fn shared_client() -> AppResult<&'static reqwest::Client> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::other(e.to_string()))?;
    Ok(CLIENT.get_or_init(|| built))
}

pub async fn request(req: HttpRequest) -> AppResult<HttpResponse> {
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err(AppError::other("only http(s) URLs are allowed"));
    }
    request_with_client(shared_client()?, req).await
}

pub(crate) async fn request_with_client(
    client: &reqwest::Client,
    req: HttpRequest,
) -> AppResult<HttpResponse> {
    let mut builder = match req.method.as_str() {
        "GET" => client.get(&req.url),
        "POST" => client.post(&req.url),
        other => return Err(AppError::other(format!("unsupported method {other}"))),
    };
    for (k, v) in &req.headers {
        let mut value = reqwest::header::HeaderValue::from_str(v)
            .map_err(|_| AppError::other("Invalid HTTP header value."))?;
        value.set_sensitive(matches!(
            k.as_str(),
            "authorization" | "private-token" | "api-key" | "x-api-key"
        ));
        builder = builder.header(k, value);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| AppError::other(format!("request failed: {e}")))?;
    let status = response.status().as_u16();
    let header = |name| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let link = header("link");
    let next_page = header("x-next-page");
    let body = response
        .text()
        .await
        .map_err(|e| AppError::other(format!("failed to read response: {e}")))?;
    Ok(HttpResponse {
        status,
        body,
        link,
        next_page,
    })
}
