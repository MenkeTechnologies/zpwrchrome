use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Debug)]
pub struct Request {
    pub id: u64,
    pub kind: String,
    #[serde(default)]
    pub op: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Serialize, Debug)]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub err: Option<String>,
}

impl Response {
    pub fn ok(id: u64, data: Value) -> Self {
        Self { id, ok: true, data: Some(data), err: None }
    }
    pub fn err(id: u64, msg: impl Into<String>) -> Self {
        Self { id, ok: false, data: None, err: Some(msg.into()) }
    }
}
