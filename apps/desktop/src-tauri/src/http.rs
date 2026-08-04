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
}

pub async fn request(req: HttpRequest) -> AppResult<HttpResponse> {
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err(AppError::other("only http(s) URLs are allowed"));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::other(e.to_string()))?;

    let mut builder = match req.method.as_str() {
        "GET" => client.get(&req.url),
        "POST" => client.post(&req.url),
        other => return Err(AppError::other(format!("unsupported method {other}"))),
    };
    for (k, v) in &req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| AppError::other(format!("request failed: {e}")))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::other(format!("failed to read response: {e}")))?;
    Ok(HttpResponse { status, body })
}
