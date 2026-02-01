use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod data_format;
pub mod json_tx;
pub mod params;
pub mod parse_tx;
pub mod pubkey;
pub mod raw_tx;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RawAccountMeta {
    pub pubkey: Value,
    #[serde(default)]
    pub is_signer: bool,
    #[serde(default)]
    pub is_writable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RawInstruction {
    pub program_id: String,
    #[serde(default)]
    pub data: Value,
    #[serde(default)]
    pub accounts: Vec<RawAccountMeta>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RawTransaction {
    pub instructions: Vec<RawInstruction>,
    pub signers: Vec<Value>,
    #[serde(default)]
    pub lookup_tables: Option<Vec<Value>>,
}
