mod protocol;
mod sandbox;

use protocol::*;
use serde_json::Value;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

/// Max size of a single JSON-RPC message from deno (10 MiB)
const MAX_LINE_BYTES: usize = 10 * 1024 * 1024;

/// Max allowed timeout (5 minutes)
const MAX_TIMEOUT_MS: u64 = 300_000;

#[tokio::main]
async fn main() {
    let result = run().await;

    // Output is the JSON-RPC response — always exactly one line
    let output = serde_json::to_string(&result).unwrap();
    println!("{output}");
}

async fn run() -> JsonRpcResponse {
    // 1. Read execute request from stdin (single JSON line)
    let mut stdin = BufReader::new(tokio::io::stdin()).lines();
    let line = match stdin.next_line().await {
        Ok(Some(line)) => line,
        _ => {
            return JsonRpcResponse::error(
                Value::Null,
                -32600,
                "No input received".into(),
            );
        }
    };

    let request: JsonRpcRequest = match serde_json::from_str(&line) {
        Ok(r) => r,
        Err(e) => {
            return JsonRpcResponse::error(
                Value::Null,
                -32700,
                format!("Parse error: {e}"),
            );
        }
    };

    let request_id = request.id.clone().unwrap_or(Value::Null);

    // Validate method
    if request.method != "execute" {
        return JsonRpcResponse::error(
            request_id,
            -32601,
            format!("Unknown method: {}", request.method),
        );
    }

    let params: ExecuteParams = match request.params {
        Some(p) => match serde_json::from_value(p) {
            Ok(ep) => ep,
            Err(e) => {
                return JsonRpcResponse::error(
                    request_id,
                    -32602,
                    format!("Invalid params: {e}"),
                );
            }
        },
        None => {
            return JsonRpcResponse::error(
                request_id,
                -32602,
                "Missing params".into(),
            );
        }
    };

    // Validate params
    if params.code.is_empty() {
        return JsonRpcResponse::error(request_id, -32602, "Empty code".into());
    }

    let timeout_ms = params.timeout.min(MAX_TIMEOUT_MS);
    let timeout = Duration::from_millis(timeout_ms);

    // Validate provider names are valid JS identifiers
    for p in &params.providers {
        if !is_valid_js_identifier(&p.name) {
            return JsonRpcResponse::error(
                request_id,
                -32602,
                format!("Invalid provider name: {}", p.name),
            );
        }
    }

    // 2. Spawn deno sandbox
    let mut sandbox = match sandbox::Sandbox::spawn() {
        Ok(s) => s,
        Err(e) => {
            return JsonRpcResponse::error(
                request_id,
                -32000,
                format!("Spawn failed: {e}"),
            );
        }
    };

    // 3. Send initialize to deno
    let init = JsonRpcRequest::initialize(
        1,
        InitializeParams {
            code: params.code,
            providers: params.providers,
        },
    );
    let init_json = serde_json::to_string(&init).unwrap();
    if let Err(e) = sandbox.send(&init_json).await {
        return JsonRpcResponse::error(request_id, -32000, format!("Send init: {e}"));
    }

    // 4. Relay loop with timeout
    let relay_result = tokio::time::timeout(timeout, relay(&mut sandbox, &mut stdin)).await;

    match relay_result {
        Ok(Ok(exec_result)) => {
            JsonRpcResponse::result(request_id, serde_json::to_value(exec_result).unwrap())
        }
        Ok(Err(e)) => JsonRpcResponse::error(request_id, -32000, e),
        Err(_) => {
            sandbox.kill();
            JsonRpcResponse::error(request_id, -32000, "Execution timed out".into())
        }
    }
}

/// Relay loop: read from deno stdout, dispatch tool calls, return on execute/result.
async fn relay(
    sandbox: &mut sandbox::Sandbox,
    adapter_stdin: &mut tokio::io::Lines<BufReader<tokio::io::Stdin>>,
) -> Result<ExecuteResult, String> {
    loop {
        // Read next line from deno
        let line = match sandbox.recv().await? {
            Some(line) => line,
            None => {
                return Err("Deno exited without result".into());
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Output size cap
        if trimmed.len() > MAX_LINE_BYTES {
            return Err(format!(
                "Sandbox output exceeds {} MiB limit",
                MAX_LINE_BYTES / (1024 * 1024)
            ));
        }

        let msg: Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("Parse deno output: {e}"))?;

        // Validate JSON-RPC structure
        let jsonrpc = msg.get("jsonrpc").and_then(|v| v.as_str()).unwrap_or("");
        if jsonrpc != "2.0" {
            continue; // skip non-JSON-RPC messages
        }

        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

        match method {
            "tool/call" => {
                // Validate tool call has required fields
                let params = msg.get("params");
                let has_provider = params
                    .and_then(|p| p.get("provider"))
                    .and_then(|v| v.as_str())
                    .is_some();
                let has_tool = params
                    .and_then(|p| p.get("tool"))
                    .and_then(|v| v.as_str())
                    .is_some();
                let has_id = msg.get("id").is_some();

                if !has_provider || !has_tool || !has_id {
                    // Malformed tool call — skip
                    continue;
                }

                // Forward tool call to adapter (our stdout)
                println!("{}", serde_json::to_string(&msg).unwrap());

                // Read tool response from adapter (our stdin)
                let response_line = adapter_stdin
                    .next_line()
                    .await
                    .map_err(|e| format!("Read adapter response: {e}"))?
                    .ok_or_else(|| "Adapter closed stdin during tool call".to_string())?;

                // Validate adapter response is valid JSON before forwarding
                let _: Value = serde_json::from_str(&response_line)
                    .map_err(|e| format!("Adapter sent invalid JSON: {e}"))?;

                // Forward response to deno
                sandbox.send(&response_line).await?;
            }
            "execute/result" => {
                // Extract the result from params
                let params = msg
                    .get("params")
                    .ok_or("execute/result missing params")?;

                let exec_result: ExecuteResult = serde_json::from_value(params.clone())
                    .map_err(|e| format!("Parse execute/result: {e}"))?;

                return Ok(exec_result);
            }
            _ => {
                // Ignore unknown methods
            }
        }
    }
}

fn is_valid_js_identifier(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_alphabetic() && first != '_' && first != '$' {
        return false;
    }
    chars.all(|c| c.is_alphanumeric() || c == '_' || c == '$')
}
