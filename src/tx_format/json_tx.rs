use std::{fs, path::Path, str::FromStr};

use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signer::keypair::Keypair,
};

use crate::tx_format::{
    RawInstruction, RawTransaction,
    data_format::pack_data,
    params::resolve_value,
    pubkey::parse_pubkey,
    raw_tx::{close_ata_tx, create_ata_tx, set_cu_limit_tx, transfer_tx},
};

pub fn parse_keypair(value: &Value, params: &[String]) -> Result<Keypair> {
    let resolved = resolve_value(value, params);
    match resolved {
        Value::String(path) => {
            let data = fs::read_to_string(&path)
                .with_context(|| format!("failed to read keypair file {path}"))?;
            let bytes: Vec<u8> = serde_json::from_str(&data)
                .with_context(|| format!("invalid keypair JSON in {path}"))?;
            Keypair::try_from(bytes.as_slice()).map_err(|err| anyhow!("Invalid keypair: {err}"))
        }
        Value::Array(items) => {
            let mut bytes = Vec::with_capacity(items.len());
            for item in items {
                let num = item
                    .as_u64()
                    .ok_or_else(|| anyhow!("Invalid keypair array"))?;
                bytes.push(num as u8);
            }
            Keypair::try_from(bytes.as_slice()).map_err(|err| anyhow!("Invalid keypair: {err}"))
        }
        _ => Err(anyhow!("Unsupported keypair value")),
    }
}

fn value_as_string(value: &Value, label: &str) -> Result<String> {
    value
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Missing or invalid {label}"))
}

fn parse_ix_from_json(ix: &RawInstruction, params: &[String]) -> Result<Instruction> {
    match ix.program_id.as_str() {
        "set_cu_limit" => {
            let limit = ix
                .extra
                .get("limit")
                .and_then(Value::as_u64)
                .ok_or_else(|| anyhow!("Missing limit"))? as u32;
            let raw = set_cu_limit_tx(limit);
            parse_ix_from_json(&raw, params)
        }
        "transfer" => {
            let from = ix
                .extra
                .get("from")
                .ok_or_else(|| anyhow!("Missing from"))?;
            let to = ix.extra.get("to").ok_or_else(|| anyhow!("Missing to"))?;
            let amount = ix
                .extra
                .get("amount")
                .ok_or_else(|| anyhow!("Missing amount"))?;
            let raw = transfer_tx(
                &value_as_string(from, "from")?,
                &value_as_string(to, "to")?,
                amount,
            );
            parse_ix_from_json(&raw, params)
        }
        "create_ata" => {
            let owner = ix
                .extra
                .get("owner")
                .ok_or_else(|| anyhow!("Missing owner"))?;
            let mint = ix
                .extra
                .get("mint")
                .ok_or_else(|| anyhow!("Missing mint"))?;
            let raw = create_ata_tx(
                &value_as_string(owner, "owner")?,
                &value_as_string(mint, "mint")?,
            );
            parse_ix_from_json(&raw, params)
        }
        "close_ata" => {
            let owner = ix
                .extra
                .get("owner")
                .ok_or_else(|| anyhow!("Missing owner"))?;
            let mint = ix
                .extra
                .get("mint")
                .ok_or_else(|| anyhow!("Missing mint"))?;
            let raw = close_ata_tx(
                &value_as_string(owner, "owner")?,
                &value_as_string(mint, "mint")?,
            );
            parse_ix_from_json(&raw, params)
        }
        _ => {
            let program_id = Pubkey::from_str(&ix.program_id)
                .map_err(|err| anyhow!("Invalid program id {}: {err}", ix.program_id))?;
            let mut accounts = Vec::new();
            for acc in &ix.accounts {
                let pubkey = parse_pubkey(&acc.pubkey, params)?;
                accounts.push(AccountMeta {
                    pubkey,
                    is_signer: acc.is_signer,
                    is_writable: acc.is_writable,
                });
            }
            let data = pack_data(&ix.data, params)?;
            Ok(Instruction {
                program_id,
                accounts,
                data,
            })
        }
    }
}

#[derive(Debug)]
pub struct ParsedTransaction {
    pub instructions: Vec<Instruction>,
    pub signers: Vec<Keypair>,
    pub lookup_tables: Vec<Pubkey>,
}

pub fn parse_tx_from_json(tx: &RawTransaction, params: &[String]) -> Result<ParsedTransaction> {
    let mut instructions = Vec::with_capacity(tx.instructions.len());
    for ix in &tx.instructions {
        instructions.push(parse_ix_from_json(ix, params)?);
    }

    let mut signers = Vec::with_capacity(tx.signers.len());
    for signer in &tx.signers {
        signers.push(parse_keypair(signer, params)?);
    }

    let mut lookup_tables = Vec::new();
    if let Some(tables) = &tx.lookup_tables {
        for table in tables {
            lookup_tables.push(parse_pubkey(table, params)?);
        }
    }

    Ok(ParsedTransaction {
        instructions,
        signers,
        lookup_tables,
    })
}

pub fn load_raw_tx_from_json(path: impl AsRef<Path>) -> Result<RawTransaction> {
    let data = fs::read_to_string(&path)
        .with_context(|| format!("Error reading file {:?}", path.as_ref()))?;
    serde_json::from_str(&data).with_context(|| format!("Invalid JSON in {:?}", path.as_ref()))
}

pub fn load_parsed_tx_from_json(
    path: impl AsRef<Path>,
    params: &[String],
) -> Result<ParsedTransaction> {
    let tx = load_raw_tx_from_json(path)?;
    parse_tx_from_json(&tx, params)
}
