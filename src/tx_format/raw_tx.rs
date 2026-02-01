use serde_json::json;

use crate::{
    accounts::{
        ASSOCIATED_TOKEN_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID,
    },
    tx_format::{RawAccountMeta, RawInstruction},
};

pub fn set_cu_limit_tx(limit: u32) -> RawInstruction {
    RawInstruction {
        program_id: COMPUTE_BUDGET_PROGRAM_ID.to_string(),
        accounts: Vec::new(),
        data: json!({
            "type": "object",
            "data": [
                {"type": "u8", "data": 2},
                {"type": "u32", "data": limit}
            ]
        }),
        extra: serde_json::Map::new(),
    }
}

pub fn create_ata_tx(owner: &str, mint: &str) -> RawInstruction {
    RawInstruction {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID.to_string(),
        accounts: vec![
            RawAccountMeta {
                pubkey: json!(owner),
                is_signer: true,
                is_writable: true,
            },
            RawAccountMeta {
                pubkey: json!({
                    "type": "ata",
                    "owner": owner,
                    "mint": mint
                }),
                is_signer: false,
                is_writable: true,
            },
            RawAccountMeta {
                pubkey: json!(owner),
                is_signer: true,
                is_writable: true,
            },
            RawAccountMeta {
                pubkey: json!(mint),
                is_signer: false,
                is_writable: false,
            },
            RawAccountMeta {
                pubkey: json!(SYSTEM_PROGRAM_ID.to_string()),
                is_signer: false,
                is_writable: false,
            },
            RawAccountMeta {
                pubkey: json!(TOKEN_PROGRAM_ID.to_string()),
                is_signer: false,
                is_writable: false,
            },
        ],
        data: json!(0),
        extra: serde_json::Map::new(),
    }
}

pub fn close_ata_tx(owner: &str, mint: &str) -> RawInstruction {
    RawInstruction {
        program_id: TOKEN_PROGRAM_ID.to_string(),
        accounts: vec![
            RawAccountMeta {
                pubkey: json!({
                    "type": "ata",
                    "owner": owner,
                    "mint": mint
                }),
                is_signer: false,
                is_writable: true,
            },
            RawAccountMeta {
                pubkey: json!(owner),
                is_signer: true,
                is_writable: true,
            },
            RawAccountMeta {
                pubkey: json!(owner),
                is_signer: true,
                is_writable: true,
            },
        ],
        data: json!({
            "type": "u8",
            "data": 9
        }),
        extra: serde_json::Map::new(),
    }
}

pub fn transfer_tx(from: &str, to: &str, amount: &serde_json::Value) -> RawInstruction {
    RawInstruction {
        program_id: SYSTEM_PROGRAM_ID.to_string(),
        data: json!({
            "type": "object",
            "data": [
                {"type": "u32", "data": 2},
                {"type": "u64", "data": amount}
            ]
        }),
        accounts: vec![
            RawAccountMeta {
                pubkey: json!(from),
                is_signer: true,
                is_writable: true,
            },
            RawAccountMeta {
                pubkey: json!(to),
                is_signer: false,
                is_writable: true,
            },
        ],
        extra: serde_json::Map::new(),
    }
}
