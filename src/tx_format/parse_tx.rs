use std::str::FromStr;

use anyhow::{Result, anyhow};
use bs58;
use serde_json::{Value, json};
use solana_sdk::pubkey::Pubkey;
use solana_transaction_status::{
    EncodedConfirmedTransactionWithStatusMeta, EncodedTransaction, UiInstruction, UiMessage,
    UiParsedInstruction, UiParsedMessage,
};

use crate::accounts::{ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID};

fn decode_base58_to_hex(data: &str) -> Result<String> {
    let bytes = bs58::decode(data)
        .into_vec()
        .map_err(|_| anyhow!("Invalid base58 data"))?;
    Ok(format!("0x{}", hex::encode(bytes)))
}

#[derive(Debug, Clone)]
struct AccountInfo {
    pubkey: String,
    signer: bool,
    writable: bool,
}

fn accounts_from_parsed(message: &UiParsedMessage) -> Vec<AccountInfo> {
    message
        .account_keys
        .iter()
        .map(|acc| AccountInfo {
            pubkey: acc.pubkey.clone(),
            signer: acc.signer,
            writable: acc.writable,
        })
        .collect()
}

fn accounts_from_raw(message: &solana_transaction_status::UiRawMessage) -> Vec<AccountInfo> {
    let header = &message.header;
    let num_signers = header.num_required_signatures as usize;
    let num_readonly_signed = header.num_readonly_signed_accounts as usize;
    let num_readonly_unsigned = header.num_readonly_unsigned_accounts as usize;

    let mut out = Vec::with_capacity(message.account_keys.len());
    for (idx, key) in message.account_keys.iter().enumerate() {
        let is_signer = idx < num_signers;
        let is_writable = if is_signer {
            idx < num_signers - num_readonly_signed
        } else {
            idx < message.account_keys.len() - num_readonly_unsigned
        };
        out.push(AccountInfo {
            pubkey: key.clone(),
            signer: is_signer,
            writable: is_writable,
        });
    }
    out
}

fn find_ata_accounts(accounts: &[String]) -> Vec<Value> {
    println!("Finding ATA accounts...");
    let mut ata_accounts = Vec::new();
    for owner in accounts {
        for mint in accounts {
            let owner_key = Pubkey::from_str(owner);
            let mint_key = Pubkey::from_str(mint);
            if owner_key.is_err() || mint_key.is_err() {
                continue;
            }
            let owner_key = owner_key.unwrap();
            let mint_key = mint_key.unwrap();
            let seeds = [
                owner_key.as_ref(),
                TOKEN_PROGRAM_ID.as_ref(),
                mint_key.as_ref(),
            ];
            let (ata, _) = Pubkey::find_program_address(&seeds, &ASSOCIATED_TOKEN_PROGRAM_ID);
            let ata_str = ata.to_string();
            if accounts.contains(&ata_str) {
                println!("Found ATA: {ata_str} for owner: {owner} and mint: {mint}");
                ata_accounts.push(json!({
                    "type": "ata",
                    "owner": owner,
                    "mint": mint,
                    "pubkey": ata_str
                }));
            }
        }
    }
    ata_accounts
}

pub fn parse_native_program(program_id: &str, parsed: &Value) -> (Vec<String>, Option<Value>) {
    if !parsed.is_object() {
        return (Vec::new(), None);
    }

    let parsed_type = parsed.get("type").and_then(Value::as_str);
    let info = parsed.get("info");

    if program_id == SYSTEM_PROGRAM_ID.to_string() {
        if parsed_type == Some("transfer") {
            if let Some(info) = info.and_then(Value::as_object) {
                let lamports = info.get("lamports").cloned().unwrap_or(Value::Null);
                let source = info
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let destination = info
                    .get("destination")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                return (
                    vec![source, destination],
                    Some(json!({
                        "type": "object",
                        "data": [
                            {"type": "u32", "data": 2},
                            {"type": "u64", "data": lamports}
                        ]
                    })),
                );
            }
        }
        let accounts = info
            .and_then(Value::as_object)
            .map(|map| {
                map.values()
                    .filter_map(|value| value.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        return (accounts, None);
    }

    if program_id == ASSOCIATED_TOKEN_PROGRAM_ID.to_string() {
        let mut accounts = Vec::new();
        if let Some(info) = info.and_then(Value::as_object) {
            for key in [
                "wallet",
                "account",
                "source",
                "mint",
                "systemProgram",
                "tokenProgram",
            ] {
                if let Some(value) = info.get(key).and_then(Value::as_str) {
                    accounts.push(value.to_string());
                }
            }
        }
        return (accounts, None);
    }

    let accounts = info
        .and_then(Value::as_object)
        .map(|map| {
            map.values()
                .filter_map(|value| value.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let data = match info {
        Some(Value::String(_)) | Some(Value::Number(_)) => info.cloned(),
        _ => None,
    };

    (accounts, data)
}

pub fn parse_tx_to_json(raw_tx: &EncodedConfirmedTransactionWithStatusMeta) -> Result<Value> {
    let transaction = match &raw_tx.transaction.transaction {
        EncodedTransaction::Json(tx) => tx,
        _ => return Err(anyhow!("Transaction encoding is not JSON")),
    };

    let (account_infos, instructions): (Vec<AccountInfo>, Vec<UiInstruction>) =
        match &transaction.message {
            UiMessage::Parsed(msg) => (accounts_from_parsed(msg), msg.instructions.clone()),
            UiMessage::Raw(msg) => (
                accounts_from_raw(msg),
                msg.instructions
                    .iter()
                    .cloned()
                    .map(UiInstruction::Compiled)
                    .collect(),
            ),
        };

    let signers_accounts: Vec<String> = account_infos
        .iter()
        .filter(|k| k.signer)
        .map(|k| k.pubkey.clone())
        .collect();
    let writable_accounts: Vec<String> = account_infos
        .iter()
        .filter(|k| k.writable)
        .map(|k| k.pubkey.clone())
        .collect();

    println!("Signers accounts: {}", signers_accounts.join(", "));

    let accounts: Vec<String> = account_infos.iter().map(|k| k.pubkey.clone()).collect();
    let ata_accounts = find_ata_accounts(&accounts);

    let normalize_instruction = |ix: &UiInstruction| -> Result<Value> {
        let (program_id, accounts_list, mut data) = match ix {
            UiInstruction::Compiled(compiled) => {
                let program_index = compiled.program_id_index as usize;
                let program_id = account_infos
                    .get(program_index)
                    .map(|k| k.pubkey.clone())
                    .unwrap_or_default();
                let mut accounts_list = Vec::new();
                for index in &compiled.accounts {
                    if let Some(acc) = account_infos.get(*index as usize) {
                        accounts_list.push(acc.pubkey.clone());
                    }
                }
                (
                    program_id,
                    accounts_list,
                    Value::String(compiled.data.clone()),
                )
            }
            UiInstruction::Parsed(UiParsedInstruction::Parsed(parsed)) => {
                let program_id = parsed.program_id.clone();
                let (parsed_accounts, parsed_data) =
                    parse_native_program(&program_id, &parsed.parsed);
                let data = parsed_data.unwrap_or_else(|| {
                    parsed
                        .parsed
                        .get("info")
                        .cloned()
                        .unwrap_or_else(|| parsed.parsed.clone())
                });
                (program_id, parsed_accounts, data)
            }
            UiInstruction::Parsed(UiParsedInstruction::PartiallyDecoded(partial)) => (
                partial.program_id.clone(),
                partial.accounts.clone(),
                Value::String(partial.data.clone()),
            ),
        };

        println!("Parsing instruction for program {}...", program_id);

        if let Value::String(s) = &data {
            data = Value::String(decode_base58_to_hex(s)?);
        }

        let mut accounts_output = Vec::new();
        for account in accounts_list {
            let mut pubkey_value: Value = Value::String(account.clone());
            for ata in &ata_accounts {
                if ata.get("pubkey").and_then(Value::as_str) == Some(account.as_str()) {
                    pubkey_value = json!({
                        "type": "ata",
                        "owner": ata.get("owner").cloned().unwrap_or(Value::Null),
                        "mint": ata.get("mint").cloned().unwrap_or(Value::Null),
                    });
                    break;
                }
            }

            if let Value::String(pk) = &pubkey_value {
                if let Some(index) = signers_accounts.iter().position(|x| x == pk) {
                    pubkey_value = Value::String(format!("${}", index + 1));
                }
            } else if let Value::Object(map) = &mut pubkey_value {
                if let Some(owner) = map.get("owner").and_then(Value::as_str) {
                    if let Some(index) = signers_accounts.iter().position(|x| x == owner) {
                        map.insert(
                            "owner".to_string(),
                            Value::String(format!("${}", index + 1)),
                        );
                    }
                }
            }

            accounts_output.push(json!({
                "pubkey": pubkey_value,
                "is_signer": signers_accounts.contains(&account),
                "is_writable": writable_accounts.contains(&account)
            }));
        }

        Ok(json!({
            "program_id": program_id,
            "data": data,
            "accounts": accounts_output
        }))
    };

    let instructions_json: Vec<Value> = instructions
        .iter()
        .map(normalize_instruction)
        .collect::<Result<_>>()?;

    let signers_json: Vec<Value> = signers_accounts
        .iter()
        .enumerate()
        .map(|(index, _)| Value::String(format!("${}", signers_accounts.len() + index + 1)))
        .collect();

    Ok(json!({
        "instructions": instructions_json,
        "signers": signers_json,
    }))
}
