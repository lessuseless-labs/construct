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
