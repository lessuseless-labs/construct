use serde::{Deserialize, Serialize};
use serde_json::Value;

// --- Generic JSON-RPC 2.0 ---

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

// --- Execute request (adapter → gun) ---

#[derive(Debug, Deserialize)]
pub struct ExecuteParams {
    pub code: String,
    #[serde(default)]
    pub providers: Vec<ProviderDef>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_timeout() -> u64 {
    30000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDef {
    pub name: String,
    pub tools: Vec<String>,
    #[serde(default, rename = "positionalArgs")]
    pub positional_args: bool,
}

// --- Initialize (gun → deno runner) ---

#[derive(Debug, Serialize)]
pub struct InitializeParams {
    pub code: String,
    pub providers: Vec<ProviderDef>,
}

// --- Tool call (deno → gun → adapter) ---

#[derive(Debug, Deserialize)]
pub struct ToolCallParams {
    pub provider: String,
    pub tool: String,
    pub args: String,
}

// --- Execute result (deno → gun → adapter) ---

#[derive(Debug, Deserialize, Serialize)]
pub struct ExecuteResult {
    pub result: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub logs: Vec<String>,
}

// --- Helpers ---

impl JsonRpcRequest {
    pub fn initialize(id: u64, params: InitializeParams) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            method: "initialize".into(),
            id: Some(Value::Number(id.into())),
            params: Some(serde_json::to_value(params).unwrap()),
        }
    }
}

impl JsonRpcResponse {
    pub fn result(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse_request(s: &str) -> JsonRpcRequest {
        serde_json::from_str(s).expect("valid JSON-RPC request")
    }

    #[test]
    fn request_parses_with_numeric_id() {
        let r = parse_request(r#"{"jsonrpc":"2.0","method":"execute","id":1,"params":{}}"#);
        assert_eq!(r.jsonrpc, "2.0");
        assert_eq!(r.method, "execute");
        assert_eq!(r.id, Some(json!(1)));
    }

    #[test]
    fn request_parses_with_string_id() {
        let r = parse_request(r#"{"jsonrpc":"2.0","method":"execute","id":"abc","params":{}}"#);
        assert_eq!(r.id, Some(json!("abc")));
    }

    #[test]
    fn request_parses_without_id_as_notification() {
        let r = parse_request(r#"{"jsonrpc":"2.0","method":"ping"}"#);
        assert!(r.id.is_none());
        assert!(r.params.is_none());
    }

    #[test]
    fn response_result_round_trip() {
        let r = JsonRpcResponse::result(json!(42), json!({"ok": true}));
        let s = serde_json::to_string(&r).unwrap();
        let parsed: JsonRpcResponse = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed.id, json!(42));
        assert_eq!(parsed.result, Some(json!({"ok": true})));
        assert!(parsed.error.is_none());
    }

    #[test]
    fn response_error_round_trip() {
        let r = JsonRpcResponse::error(json!(7), -32601, "Unknown method".into());
        let s = serde_json::to_string(&r).unwrap();
        let parsed: JsonRpcResponse = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed.id, json!(7));
        assert!(parsed.result.is_none());
        let err = parsed.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Unknown method");
    }

    #[test]
    fn response_error_omits_result_field_on_wire() {
        let r = JsonRpcResponse::error(json!(1), -1, "x".into());
        let s = serde_json::to_string(&r).unwrap();
        assert!(!s.contains("\"result\""), "error response must not include result: {s}");
    }

    #[test]
    fn response_result_omits_error_field_on_wire() {
        let r = JsonRpcResponse::result(json!(1), json!(null));
        let s = serde_json::to_string(&r).unwrap();
        assert!(!s.contains("\"error\""), "result response must not include error: {s}");
    }

    #[test]
    fn execute_params_default_timeout_is_30s() {
        let p: ExecuteParams = serde_json::from_value(json!({"code": "1+1"})).unwrap();
        assert_eq!(p.timeout, 30000);
        assert!(p.providers.is_empty());
    }

    #[test]
    fn execute_params_accepts_explicit_timeout() {
        let p: ExecuteParams =
            serde_json::from_value(json!({"code": "1+1", "timeout": 5000})).unwrap();
        assert_eq!(p.timeout, 5000);
    }

    #[test]
    fn execute_params_parses_providers() {
        let p: ExecuteParams = serde_json::from_value(json!({
            "code": "x",
            "providers": [{"name": "math", "tools": ["add", "sub"]}]
        }))
        .unwrap();
        assert_eq!(p.providers.len(), 1);
        assert_eq!(p.providers[0].name, "math");
        assert_eq!(p.providers[0].tools, vec!["add", "sub"]);
        assert!(!p.providers[0].positional_args);
    }

    #[test]
    fn execute_params_missing_code_fails() {
        let r: Result<ExecuteParams, _> = serde_json::from_value(json!({}));
        assert!(r.is_err());
    }

    #[test]
    fn provider_def_positional_args_uses_camel_case_wire() {
        let p: ProviderDef = serde_json::from_value(json!({
            "name": "p", "tools": [], "positionalArgs": true
        }))
        .unwrap();
        assert!(p.positional_args);
    }

    #[test]
    fn provider_def_positional_args_defaults_to_false() {
        let p: ProviderDef =
            serde_json::from_value(json!({"name": "p", "tools": []})).unwrap();
        assert!(!p.positional_args);
    }

    #[test]
    fn provider_def_round_trips_with_camel_case() {
        let p = ProviderDef {
            name: "x".into(),
            tools: vec!["t".into()],
            positional_args: true,
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"positionalArgs\":true"), "expected camelCase on wire: {s}");
        let back: ProviderDef = serde_json::from_str(&s).unwrap();
        assert_eq!(back.name, p.name);
        assert!(back.positional_args);
    }

    #[test]
    fn execute_result_omits_none_error_and_empty_logs() {
        let r = ExecuteResult {
            result: json!(42),
            error: None,
            logs: vec![],
        };
        let s = serde_json::to_string(&r).unwrap();
        assert!(!s.contains("\"error\""), "None error should be omitted: {s}");
        assert!(!s.contains("\"logs\""), "empty logs should be omitted: {s}");
    }

    #[test]
    fn execute_result_includes_populated_fields() {
        let r = ExecuteResult {
            result: json!(null),
            error: Some("boom".into()),
            logs: vec!["hello".into()],
        };
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"error\":\"boom\""));
        assert!(s.contains("\"logs\":[\"hello\"]"));
    }

    #[test]
    fn initialize_helper_produces_valid_shape() {
        let req = JsonRpcRequest::initialize(
            42,
            InitializeParams {
                code: "return 1".into(),
                providers: vec![],
            },
        );
        assert_eq!(req.jsonrpc, "2.0");
        assert_eq!(req.method, "initialize");
        assert_eq!(req.id, Some(json!(42)));
        let params = req.params.unwrap();
        assert_eq!(params["code"], "return 1");
        assert!(params["providers"].as_array().unwrap().is_empty());
    }

    #[test]
    fn tool_call_params_parses() {
        let p: ToolCallParams = serde_json::from_value(json!({
            "provider": "math",
            "tool": "add",
            "args": "{\"a\":1,\"b\":2}"
        }))
        .unwrap();
        assert_eq!(p.provider, "math");
        assert_eq!(p.tool, "add");
        assert_eq!(p.args, "{\"a\":1,\"b\":2}");
    }

    #[test]
    fn unicode_in_code_round_trips() {
        let code = "async () => '日本語 🦀 emoji'";
        let req_json = json!({
            "jsonrpc": "2.0",
            "method": "execute",
            "id": 1,
            "params": {"code": code}
        });
        let req: JsonRpcRequest = serde_json::from_value(req_json).unwrap();
        let params: ExecuteParams = serde_json::from_value(req.params.unwrap()).unwrap();
        assert_eq!(params.code, code);
    }

    #[test]
    fn large_code_payload_parses() {
        let code = "x".repeat(1_000_000);
        let params: ExecuteParams =
            serde_json::from_value(json!({"code": code.clone()})).unwrap();
        assert_eq!(params.code.len(), 1_000_000);
    }

    #[test]
    fn malformed_json_returns_parse_error() {
        let r: Result<JsonRpcRequest, _> = serde_json::from_str("not json");
        assert!(r.is_err());
    }

    #[test]
    fn wrong_type_for_timeout_fails() {
        let r: Result<ExecuteParams, _> =
            serde_json::from_value(json!({"code": "x", "timeout": "nope"}));
        assert!(r.is_err());
    }
}
