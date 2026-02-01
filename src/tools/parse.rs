use std::{fs, path::Path};

use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use bs58;
use serde_json::{Value, json};
use solana_commitment_config::CommitmentConfig;
use solana_rpc_client::api::config::RpcBlockConfig;
use solana_rpc_client::api::config::RpcTransactionConfig;
use solana_transaction_status::parse_accounts::ParsedAccount;
use solana_transaction_status::{
    EncodedTransaction, TransactionDetails, UiInstruction, UiMessage, UiParsedInstruction,
    UiTransactionEncoding,
};

use crate::tools::tx::{MAINNET_RPC_URL, create_connection};
use crate::tx_format::parse_tx::{parse_native_program, parse_tx_to_json};

pub fn create_json_from_tx(signature: &str, to_path: impl AsRef<Path>) -> Result<()> {
    let connection = create_connection(MAINNET_RPC_URL);
    let config = RpcTransactionConfig {
        encoding: Some(UiTransactionEncoding::JsonParsed),
        commitment: Some(CommitmentConfig::confirmed()),
        max_supported_transaction_version: Some(0),
    };
    let tx = connection
        .get_transaction_with_config(&signature.parse()?, config)
        .with_context(|| format!("Transaction not found: {signature}"))?;

    println!("Parsing transaction {signature}...");
    let json = parse_tx_to_json(&tx)?;
    fs::create_dir_all(&to_path)?;
    let out_path = to_path.as_ref().join(format!("{signature}.json"));
    fs::write(&out_path, serde_json::to_string_pretty(&json)?)?;
    println!("Transaction dumped to {}", out_path.display());
    Ok(())
}

fn find_account_name(pubkey: &str, parsed_info: &Value) -> Option<String> {
    let map = parsed_info.as_object()?;
    for (key, value) in map {
        match value {
            Value::String(s) if s == pubkey => return Some(key.clone()),
            Value::Array(arr) if arr.iter().any(|v| v.as_str() == Some(pubkey)) => {
                return Some(key.clone());
            }
            Value::Object(obj) => {
                if obj.get("pubkey").and_then(Value::as_str) == Some(pubkey)
                    || obj.get("wallet").and_then(Value::as_str) == Some(pubkey)
                    || obj.get("owner").and_then(Value::as_str) == Some(pubkey)
                {
                    return Some(key.clone());
                }
            }
            _ => {}
        }
    }
    None
}

fn normalize_ix_accounts(
    accounts: &[Value],
    account_meta: &Vec<serde_json::Value>,
    account_meta_by_pubkey: &std::collections::HashMap<String, (bool, bool)>,
    parsed_info: Option<&Value>,
) -> Vec<Value> {
    accounts
        .iter()
        .map(|acc| {
            let pubkey = if let Some(index) = acc.as_u64() {
                account_meta
                    .get(index as usize)
                    .and_then(|m| m.get("pubkey"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            } else {
                acc.as_str().map(|s| s.to_string())
            };

            let pubkey = pubkey.unwrap_or_default();
            let (is_signer, is_writable) = account_meta_by_pubkey
                .get(&pubkey)
                .copied()
                .unwrap_or((false, false));

            let mut entry = json!({
                "pubkey": pubkey,
                "isSigner": is_signer,
                "isWritable": is_writable,
            });

            if let (Some(info), Value::Object(map)) = (parsed_info, &mut entry) {
                if let Some(pubkey) = map.get("pubkey").and_then(Value::as_str) {
                    if let Some(name) = find_account_name(pubkey, info) {
                        map.insert("name".to_string(), Value::String(name));
                    }
                }
            }

            entry
        })
        .collect()
}

pub fn parse_block(slot: &str, to_path: impl AsRef<Path>) -> Result<()> {
    let block_number: u64 = slot.parse().map_err(|_| anyhow!("Invalid slot: {slot}"))?;

    let connection = create_connection(MAINNET_RPC_URL);
    let config = RpcBlockConfig {
        encoding: Some(UiTransactionEncoding::JsonParsed),
        transaction_details: Some(TransactionDetails::Full),
        rewards: Some(true),
        commitment: Some(CommitmentConfig::confirmed()),
        max_supported_transaction_version: Some(0),
    };

    let block = connection
        .get_block_with_config(block_number, config)
        .with_context(|| format!("Block not found: {slot}"))?;

    let transactions = block.transactions.unwrap_or_default();
    let mut parsed_txs = Vec::new();

    for tx in transactions {
        let ui_tx = match tx.transaction {
            EncodedTransaction::Json(tx) => tx,
            _ => continue,
        };

        let (account_keys, instructions): (Vec<ParsedAccount>, Vec<UiInstruction>) =
            match &ui_tx.message {
                UiMessage::Parsed(msg) => (msg.account_keys.clone(), msg.instructions.clone()),
                UiMessage::Raw(msg) => {
                    let mut keys = Vec::new();
                    let header = &msg.header;
                    let num_signers = header.num_required_signatures as usize;
                    let num_readonly_signed = header.num_readonly_signed_accounts as usize;
                    let num_readonly_unsigned = header.num_readonly_unsigned_accounts as usize;
                    for (idx, key) in msg.account_keys.iter().enumerate() {
                        let is_signer = idx < num_signers;
                        let is_writable = if is_signer {
                            idx < num_signers - num_readonly_signed
                        } else {
                            idx < msg.account_keys.len() - num_readonly_unsigned
                        };
                        keys.push(ParsedAccount {
                            pubkey: key.clone(),
                            signer: is_signer,
                            writable: is_writable,
                            source: None,
                        });
                    }
                    (
                        keys,
                        msg.instructions
                            .iter()
                            .cloned()
                            .map(UiInstruction::Compiled)
                            .collect(),
                    )
                }
            };

        let pre_balances = tx
            .meta
            .as_ref()
            .map(|meta| meta.pre_balances.clone())
            .unwrap_or_default();
        let post_balances = tx
            .meta
            .as_ref()
            .map(|meta| meta.post_balances.clone())
            .unwrap_or_default();

        let mut account_meta_by_pubkey = std::collections::HashMap::new();
        let mut account_meta_by_index = Vec::new();

        for (idx, key) in account_keys.iter().enumerate() {
            let pre_balance = pre_balances.get(idx).cloned();
            let post_balance = post_balances.get(idx).cloned();
            account_meta_by_pubkey.insert(key.pubkey.clone(), (key.signer, key.writable));
            account_meta_by_index.push(json!({
                "pubkey": key.pubkey,
                "isSigner": key.signer,
                "isWritable": key.writable,
                "preBalance": pre_balance,
                "postBalance": post_balance,
            }));
        }

        let instructions_out: Vec<Value> = instructions
            .iter()
            .map(|ix| {
                let (program_id, parsed_value, raw_accounts) = match ix {
                    UiInstruction::Compiled(compiled) => {
                        let program_id = account_keys
                            .get(compiled.program_id_index as usize)
                            .map(|k| k.pubkey.clone())
                            .unwrap_or_default();
                        let accounts = compiled
                            .accounts
                            .iter()
                            .map(|a| Value::Number((*a as u64).into()))
                            .collect::<Vec<_>>();
                        (program_id, None, accounts)
                    }
                    UiInstruction::Parsed(UiParsedInstruction::Parsed(parsed)) => (
                        parsed.program_id.clone(),
                        Some(parsed.parsed.clone()),
                        Vec::new(),
                    ),
                    UiInstruction::Parsed(UiParsedInstruction::PartiallyDecoded(partial)) => (
                        partial.program_id.clone(),
                        None,
                        partial
                            .accounts
                            .iter()
                            .map(|acc| Value::String(acc.clone()))
                            .collect(),
                    ),
                };

                let (native_accounts, native_data) = parsed_value
                    .as_ref()
                    .map(|parsed| parse_native_program(&program_id, parsed))
                    .unwrap_or((Vec::new(), None));

                let mut data = native_data.or_else(|| {
                    parsed_value.as_ref().map(|parsed| {
                        parsed
                            .get("info")
                            .cloned()
                            .unwrap_or_else(|| parsed.clone())
                    })
                });
                if data.is_none() {
                    if let UiInstruction::Compiled(compiled) = ix {
                        data = Some(Value::String(compiled.data.clone()));
                    }
                }

                let mut data_value = data.unwrap_or(Value::Null);
                if let Value::String(text) = &data_value {
                    let bytes = STANDARD
                        .decode(text)
                        .ok()
                        .or_else(|| bs58::decode(text).into_vec().ok());
                    if let Some(bytes) = bytes {
                        if !bytes.is_empty() {
                            data_value = Value::String(format!("0x{}", hex::encode(bytes)));
                        }
                    }
                }

                let account_values = if !raw_accounts.is_empty() {
                    raw_accounts
                } else {
                    native_accounts
                        .iter()
                        .map(|acc| Value::String(acc.clone()))
                        .collect()
                };

                let accounts_normalized = normalize_ix_accounts(
                    &account_values,
                    &account_meta_by_index,
                    &account_meta_by_pubkey,
                    parsed_value.as_ref(),
                );

                json!({
                    "program": program_id,
                    "data": data_value,
                    "accounts": accounts_normalized,
                })
            })
            .collect();

        let accounts_meta: Vec<Value> = account_meta_by_index
            .iter()
            .map(|entry| {
                let pre = entry.get("preBalance").and_then(Value::as_u64);
                let post = entry.get("postBalance").and_then(Value::as_u64);
                let change = match (pre, post) {
                    (Some(pre), Some(post)) => post as i64 - pre as i64,
                    _ => 0,
                };
                let mut out = entry.clone();
                if let Value::Object(map) = &mut out {
                    map.insert("balanceChange".to_string(), Value::Number(change.into()));
                }
                out
            })
            .collect();

        let logs = tx
            .meta
            .as_ref()
            .and_then(|meta| Option::<Vec<String>>::from(meta.log_messages.clone()))
            .unwrap_or_default();

        parsed_txs.push(json!({
            "signature": ui_tx.signatures.first().cloned().unwrap_or_default(),
            "ixs": instructions_out,
            "meta": {
                "logs": logs,
                "accounts": accounts_meta,
            }
        }));
    }

    fs::create_dir_all(&to_path)?;
    let file_path = to_path.as_ref().join(format!("{block_number}.json"));
    let payload = json!({
        "slot": block_number.to_string(),
        "txs": parsed_txs,
    });
    fs::write(&file_path, serde_json::to_string_pretty(&payload)?)?;
    println!("Parsed block saved to {}", file_path.display());
    Ok(())
}
