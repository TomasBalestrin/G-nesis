//! Reusable HTTP client for integrations.
//!
//! Built once per integration invocation; reuses reqwest's connection pool
//! across calls within a single client instance. Two strict invariants:
//!
//!   1. The api_key NEVER lands in a log line. `Debug` is hand-rolled to
//!      redact tokens; reqwest errors are scrubbed via `without_url()`
//!      before they're stringified, since a `Query`-auth URL would
//!      otherwise carry the secret.
//!   2. Every request carries a `User-Agent: Genesis/1.0` header and a
//!      15s timeout. Both are enforced at builder time so callers can't
//!      accidentally drop them by re-building the inner reqwest client.

use std::fmt;
use std::time::Duration;

use reqwest::{Client, RequestBuilder, StatusCode};
use serde_json::Value;

const USER_AGENT: &str = "Genesis/1.0";
const DEFAULT_TIMEOUT_SECS: u64 = 15;

/// Runtime auth payload. Mirrors `integrations::config::AuthType` but
/// carries the resolved api_key alongside, so the client can be built
/// once and reused across multiple calls without re-reading the TOML.
#[derive(Clone)]
pub enum AuthConfig {
    Bearer(String),
    Header { name: String, value: String },
    Query { param: String, value: String },
}

/// Hand-rolled `Debug` so the api_key never lands in `tracing` output
/// or panic messages. The variant + field names survive — that's
/// non-secret structural info useful when triaging which integration
/// faulted.
impl fmt::Debug for AuthConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bearer(_) => f.debug_tuple("Bearer").field(&"<redacted>").finish(),
            Self::Header { name, .. } => f
                .debug_struct("Header")
                .field("name", name)
                .field("value", &"<redacted>")
                .finish(),
            Self::Query { param, .. } => f
                .debug_struct("Query")
                .field("param", param)
                .field("value", &"<redacted>")
                .finish(),
        }
    }
}

/// Categorized failure modes. Callers in `commands/integrations` map
/// these to user-facing toasts; the chat orchestrator may map them
/// to retry policy. `Server` carries body text so the chat can show
/// the upstream error message — but only the body, never the URL
/// (URLs may contain Query-auth secrets, scrubbed at construction).
#[derive(Debug, Clone)]
pub enum IntegrationError {
    Network(String),
    Auth(String),
    NotFound(String),
    Server { status: u16, body: String },
    Parse(String),
    Timeout,
}

impl fmt::Display for IntegrationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network(msg) => write!(f, "network error: {msg}"),
            Self::Auth(msg) => write!(f, "auth error: {msg}"),
            Self::NotFound(msg) => write!(f, "not found: {msg}"),
            Self::Server { status, body } => {
                write!(f, "server error: HTTP {status}: {}", truncate_body(body))
            }
            Self::Parse(msg) => write!(f, "parse error: {msg}"),
            Self::Timeout => write!(f, "request timed out after {DEFAULT_TIMEOUT_SECS}s"),
        }
    }
}

impl std::error::Error for IntegrationError {}

/// Long upstream error bodies (HTML 500 pages, big JSON payloads) make
/// for noisy chat replies. 200 chars is enough to convey what happened
/// without flooding the bubble.
fn truncate_body(body: &str) -> String {
    const MAX: usize = 200;
    if body.chars().count() <= MAX {
        body.to_string()
    } else {
        let prefix: String = body.chars().take(MAX).collect();
        format!("{prefix}…")
    }
}

/// Reusable client. Build via `new`; reuse for as many `get` /
/// `health_check` calls as needed in the same logical operation.
/// Custom `Debug` impl omits `auth` to avoid leaking the key.
pub struct IntegrationClient {
    client: Client,
    base_url: String,
    auth: AuthConfig,
}

impl fmt::Debug for IntegrationClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IntegrationClient")
            .field("base_url", &self.base_url)
            .field("auth", &self.auth) // already redacts via AuthConfig Debug
            .finish_non_exhaustive()
    }
}

impl IntegrationClient {
    /// Construct the client with the canonical timeout + User-Agent.
    /// Caller passes the resolved `auth` (api_key already pulled from
    /// config.toml). Errors only when reqwest can't build the inner
    /// client — an extremely rare misconfiguration of the runtime.
    pub fn new(
        base_url: impl Into<String>,
        auth: AuthConfig,
    ) -> Result<Self, IntegrationError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| IntegrationError::Network(scrub(e)))?;
        Ok(Self {
            client,
            base_url: base_url.into(),
            auth,
        })
    }

    /// GET `<base_url>/<path>` and parse the response as JSON.
    /// `path` may be relative (joined with `base_url`) or absolute
    /// (fully-qualified URL — useful for follow-up links returned by
    /// the API). Optional `query` is appended to the URL via reqwest's
    /// builder so values are URL-encoded.
    pub async fn get(
        &self,
        path: &str,
        query: Option<&[(String, String)]>,
    ) -> Result<Value, IntegrationError> {
        let url = self.join(path);
        let mut req = self.client.get(&url);
        if let Some(qs) = query {
            req = req.query(qs);
        }
        req = self.apply_auth(req);

        let resp = req.send().await.map_err(map_send_err)?;
        let status = resp.status();

        if status.is_success() {
            return resp
                .json::<Value>()
                .await
                .map_err(|e| IntegrationError::Parse(scrub(e)));
        }

        let body = resp.text().await.unwrap_or_default();
        Err(map_status_err(status, body))
    }

    /// Lightweight liveness probe — GETs the bare `base_url`. Returns
    /// `true` only on 2xx; auth/server errors come back as `Err` so
    /// callers can distinguish "API up but key invalid" from "API
    /// answered fine".
    pub async fn health_check(&self) -> Result<bool, IntegrationError> {
        let mut req = self.client.get(&self.base_url);
        req = self.apply_auth(req);

        let resp = req.send().await.map_err(map_send_err)?;
        let status = resp.status();
        if status.is_success() {
            return Ok(true);
        }
        let body = resp.text().await.unwrap_or_default();
        Err(map_status_err(status, body))
    }

    fn apply_auth(&self, req: RequestBuilder) -> RequestBuilder {
        match &self.auth {
            AuthConfig::Bearer(token) => req.bearer_auth(token),
            AuthConfig::Header { name, value } => req.header(name.as_str(), value.as_str()),
            AuthConfig::Query { param, value } => {
                req.query(&[(param.as_str(), value.as_str())])
            }
        }
    }

    fn join(&self, path: &str) -> String {
        if path.starts_with("http://") || path.starts_with("https://") {
            return path.to_string();
        }
        let base = self.base_url.trim_end_matches('/');
        let p = path.trim_start_matches('/');
        if p.is_empty() {
            base.to_string()
        } else {
            format!("{base}/{p}")
        }
    }
}

// ── error mapping ───────────────────────────────────────────────────────────

/// Strip the URL from a reqwest error before stringifying. Critical
/// when the error originated from a `Query`-auth request: the URL
/// would otherwise carry the api_key in its query string.
fn scrub(e: reqwest::Error) -> String {
    e.without_url().to_string()
}

fn map_send_err(e: reqwest::Error) -> IntegrationError {
    if e.is_timeout() {
        return IntegrationError::Timeout;
    }
    let scrubbed = scrub(e);
    IntegrationError::Network(scrubbed)
}

fn map_status_err(status: StatusCode, body: String) -> IntegrationError {
    let code = status.as_u16();
    let reason = status.canonical_reason().unwrap_or("");
    match code {
        401 | 403 => IntegrationError::Auth(format!("HTTP {code} {reason}")),
        404 => IntegrationError::NotFound(format!("HTTP {code} {reason}")),
        _ => IntegrationError::Server { status: code, body },
    }
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// AuthConfig::Debug never reveals the secret bytes — only the
    /// variant + non-secret field names survive.
    #[test]
    fn auth_config_debug_redacts_secret() {
        let bearer = AuthConfig::Bearer("supersecrettoken".into());
        let dbg = format!("{bearer:?}");
        assert!(!dbg.contains("supersecrettoken"));
        assert!(dbg.contains("redacted"));

        let hdr = AuthConfig::Header {
            name: "X-Api-Key".into(),
            value: "supersecrettoken".into(),
        };
        let dbg = format!("{hdr:?}");
        assert!(!dbg.contains("supersecrettoken"));
        assert!(dbg.contains("X-Api-Key"));

        let qry = AuthConfig::Query {
            param: "api_key".into(),
            value: "supersecrettoken".into(),
        };
        let dbg = format!("{qry:?}");
        assert!(!dbg.contains("supersecrettoken"));
        assert!(dbg.contains("api_key"));
    }

    /// Same redaction guarantee through the IntegrationClient wrapper.
    #[test]
    fn client_debug_redacts_auth() {
        let client = IntegrationClient::new(
            "https://api.example.com",
            AuthConfig::Bearer("supersecrettoken".into()),
        )
        .unwrap();
        let dbg = format!("{client:?}");
        assert!(!dbg.contains("supersecrettoken"));
        assert!(dbg.contains("api.example.com"));
    }

    #[test]
    fn join_handles_trailing_and_leading_slashes() {
        let c = IntegrationClient::new(
            "https://api.example.com/",
            AuthConfig::Bearer("t".into()),
        )
        .unwrap();
        assert_eq!(c.join("/users"), "https://api.example.com/users");
        assert_eq!(c.join("users"), "https://api.example.com/users");
        assert_eq!(c.join(""), "https://api.example.com");
    }

    #[test]
    fn join_passes_through_absolute_urls() {
        let c = IntegrationClient::new(
            "https://api.example.com",
            AuthConfig::Bearer("t".into()),
        )
        .unwrap();
        assert_eq!(
            c.join("https://other.example.com/x"),
            "https://other.example.com/x"
        );
    }

    #[test]
    fn map_status_err_dispatches_categories() {
        let auth = map_status_err(StatusCode::UNAUTHORIZED, String::new());
        assert!(matches!(auth, IntegrationError::Auth(_)));

        let forbidden = map_status_err(StatusCode::FORBIDDEN, String::new());
        assert!(matches!(forbidden, IntegrationError::Auth(_)));

        let not_found = map_status_err(StatusCode::NOT_FOUND, String::new());
        assert!(matches!(not_found, IntegrationError::NotFound(_)));

        let server = map_status_err(StatusCode::INTERNAL_SERVER_ERROR, "boom".into());
        assert!(matches!(
            server,
            IntegrationError::Server { status: 500, .. }
        ));

        let teapot = map_status_err(StatusCode::IM_A_TEAPOT, String::new());
        assert!(matches!(teapot, IntegrationError::Server { status: 418, .. }));
    }

    #[test]
    fn truncate_body_keeps_short_text() {
        assert_eq!(truncate_body("short"), "short");
    }

    #[test]
    fn truncate_body_clips_long_text() {
        let long = "x".repeat(500);
        let out = truncate_body(&long);
        assert!(out.ends_with('…'));
        // 200 char prefix + 1 ellipsis char.
        assert_eq!(out.chars().count(), 201);
    }

    #[test]
    fn integration_error_display() {
        let e = IntegrationError::Timeout;
        assert!(e.to_string().contains("timed out"));
        let e = IntegrationError::Server {
            status: 502,
            body: "bad gateway".into(),
        };
        let s = e.to_string();
        assert!(s.contains("502"));
        assert!(s.contains("bad gateway"));
    }
}
