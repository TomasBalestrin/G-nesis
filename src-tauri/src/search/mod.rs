//! Web search compartilhado: usado pelo agente skill-architect (B2) e
//! pelo orquestrador GPT principal (`commands/chat.rs` web_search
//! loop). Backend único, mesmo `BRAVE_API_KEY`, mesmo formato de
//! resultado.
//!
//! Backend chosen porque (a) tem free tier de 2k queries/mês, (b)
//! retorna JSON estruturado sem precisar parsear HTML, (c) não exige
//! conta paga pra teste. Endpoint:
//!
//! ```text
//! GET https://api.search.brave.com/res/v1/web/search?q=<termo>&count=5
//! Header: X-Subscription-Token: <BRAVE_API_KEY>
//! ```
//!
//! Resposta tem `web.results[]` com `title`, `url`, `description`. A
//! gente normaliza pra `SearchResult` (description vira snippet) e
//! limita a 5 hits — agente não precisa do resto.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const BRAVE_ENDPOINT: &str = "https://api.search.brave.com/res/v1/web/search";
const RESULT_LIMIT: usize = 5;
const REQUEST_TIMEOUT_SECS: u64 = 10;

/// Hit normalizado retornado pra o agent loop. Campos são intencionalmente
/// minimalistas — se mais info for necessária no futuro (publishedAt,
/// language), adicione aqui sem quebrar a serialização default.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Executa uma query no Brave Search. Erros user-actionable (key
/// vazia, rate-limit, 4xx/5xx) viram `Err(String)` pra que o
/// dispatcher reinjete como mensagem de tool — modelo lê e
/// auto-corrige (ex: refraseia query).
pub async fn web_search(query: &str, api_key: &str) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("query vazia".into());
    }
    if api_key.trim().is_empty() {
        return Err(
            "BRAVE_API_KEY não configurada (adicione em ~/.genesis/config.toml [search]).".into(),
        );
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("não consegui inicializar HTTP client: {e}"))?;

    let resp = client
        .get(BRAVE_ENDPOINT)
        .header("X-Subscription-Token", api_key)
        .header("Accept", "application/json")
        .query(&[
            ("q", trimmed),
            ("count", &RESULT_LIMIT.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Brave Search falhou: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet = body.chars().take(200).collect::<String>();
        return Err(format!(
            "Brave Search retornou {status}: {snippet}"
        ));
    }

    let parsed: BraveResponse = resp
        .json()
        .await
        .map_err(|e| format!("resposta da Brave Search não é JSON esperado: {e}"))?;

    let hits: Vec<SearchResult> = parsed
        .web
        .map(|w| w.results)
        .unwrap_or_default()
        .into_iter()
        .take(RESULT_LIMIT)
        .map(|r| SearchResult {
            title: r.title,
            url: r.url,
            snippet: r.description,
        })
        .collect();

    Ok(hits)
}

// ── Brave wire types ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct BraveResponse {
    #[serde(default)]
    web: Option<BraveWeb>,
}

#[derive(Debug, Deserialize)]
struct BraveWeb {
    #[serde(default)]
    results: Vec<BraveResult>,
}

#[derive(Debug, Deserialize)]
struct BraveResult {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    description: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_empty_query() {
        let err = web_search("   ", "fake-key").await.unwrap_err();
        assert!(err.contains("vazia"));
    }

    #[tokio::test]
    async fn rejects_missing_key() {
        let err = web_search("rust async", "").await.unwrap_err();
        assert!(err.contains("BRAVE_API_KEY"));
    }
}
