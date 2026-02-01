use std::{fs, path::Path, str::FromStr};

use anyhow::{Context, Result, anyhow};
use solana_address_lookup_table_interface::{
    instruction::{create_lookup_table as create_lookup_table_instruction, extend_lookup_table},
    state::AddressLookupTable,
};
use solana_commitment_config::CommitmentConfig;
use solana_rpc_client::api::config::RpcTransactionConfig;
use solana_rpc_client::rpc_client::RpcClient;
use solana_sdk::message::{
    AddressLookupTableAccount, Message, VersionedMessage, v0::Message as V0Message,
};
use solana_sdk::{
    pubkey::Pubkey,
    signature::Signature,
    signer::Signer,
    slot_hashes::SlotHashes,
    sysvar,
    transaction::VersionedTransaction,
};
use solana_system_transaction as system_transaction;
use solana_transaction_status::UiTransactionEncoding;

use crate::tx_format::{
    RawTransaction,
    json_tx::{ParsedTransaction, parse_keypair, parse_tx_from_json},
    pubkey::parse_pubkey,
    raw_tx::{close_ata_tx, create_ata_tx},
};
use crate::utils::format_amount;

pub const LOCAL_RPC_URL: &str = "http://127.0.0.1:8899";
pub const MAINNET_RPC_URL: &str = "http://api.mainnet-beta.solana.com";

pub fn create_connection(network: &str) -> RpcClient {
    RpcClient::new_with_commitment(network.to_string(), CommitmentConfig::confirmed())
}

fn confirm_signature(client: &RpcClient, signature: &Signature) -> Result<()> {
    client.poll_for_signature_with_commitment(signature, CommitmentConfig::confirmed())?;
    Ok(())
}

fn fetch_slot_hashes(client: &RpcClient) -> Result<SlotHashes> {
    let account = client.get_account(&sysvar::slot_hashes::id())?;
    let hashes: SlotHashes =
        bincode::deserialize(&account.data).map_err(|_| anyhow!("Invalid slot hashes data"))?;
    Ok(hashes)
}

fn fetch_lookup_table(client: &RpcClient, key: &Pubkey) -> Result<AddressLookupTableAccount> {
    let account = client.get_account(key)?;
    let table = AddressLookupTable::deserialize(&account.data)
        .map_err(|_| anyhow!("Failed to deserialize address lookup table"))?;
    let current_slot = client.get_slot_with_commitment(CommitmentConfig::confirmed())?;
    let slot_hashes = fetch_slot_hashes(client)?;
    if !table.meta.is_active(current_slot, &slot_hashes) {
        return Err(anyhow!("ALT {key} not found / not active"));
    }
    Ok(AddressLookupTableAccount {
        key: *key,
        addresses: table.addresses.to_vec(),
    })
}

pub fn execute_json_transaction(
    json_tx: ParsedTransaction,
    payer_pubkey: Option<Pubkey>,
) -> Result<()> {
    let client = create_connection(LOCAL_RPC_URL);
    let payer = match payer_pubkey {
        Some(payer) => payer,
        None => json_tx
            .signers
            .first()
            .ok_or_else(|| anyhow!("Missing transaction signer"))?
            .pubkey(),
    };

    let mut lookup_accounts = Vec::new();
    for table in &json_tx.lookup_tables {
        lookup_accounts.push(fetch_lookup_table(&client, table)?);
    }

    let (blockhash, _) =
        client.get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())?;

    let versioned_message = if lookup_accounts.is_empty() {
        let message = Message::new_with_blockhash(&json_tx.instructions, Some(&payer), &blockhash);
        VersionedMessage::Legacy(message)
    } else {
        let message =
            V0Message::try_compile(&payer, &json_tx.instructions, &lookup_accounts, blockhash)?;
        VersionedMessage::V0(message)
    };

    let tx = VersionedTransaction::try_new(versioned_message, &json_tx.signers)?;

    let balance_before = client.get_balance(&payer)? as i128;
    let sig = client.send_transaction(&tx)?;
    confirm_signature(&client, &sig)?;

    println!("Transaction sent: {sig}");

    let parsed_tx = client.get_transaction_with_config(
        &sig,
        RpcTransactionConfig {
            encoding: Some(UiTransactionEncoding::JsonParsed),
            commitment: Some(CommitmentConfig::confirmed()),
            max_supported_transaction_version: Some(0),
        },
    )?;

    if let Some(meta) = parsed_tx.transaction.meta {
        let logs: Option<Vec<String>> = meta.log_messages.into();
        if let Some(logs) = logs {
            for log in logs {
                println!("{log}");
            }
        }
        let compute_units: Option<u64> = meta.compute_units_consumed.into();
        if let Some(units) = compute_units {
            println!("Total CUs used: {units}");
        } else {
            println!("Total CUs used: n/a");
        }
    }

    let balance_after = client.get_balance(&payer)? as i128;
    let amount_changed = balance_after - balance_before;
    println!(
        "Balance changed: {} lamports",
        format_amount(amount_changed)
    );

    Ok(())
}

pub fn get_balance(address: &str) -> Result<()> {
    let client = create_connection(LOCAL_RPC_URL);
    let pubkey = Pubkey::from_str(address)?;
    let balance = client.get_balance(&pubkey)?;
    println!("Balance of {address}: {} lamports", format_amount(balance));
    Ok(())
}

pub fn airdrop_sol(address: &str, amount: u64) -> Result<()> {
    let client = create_connection(LOCAL_RPC_URL);
    let pubkey = Pubkey::from_str(address)?;
    let sig = client.request_airdrop(&pubkey, amount)?;
    confirm_signature(&client, &sig)?;
    println!(
        "Airdrop successful: {} lamports to {address}",
        format_amount(amount)
    );
    Ok(())
}

pub fn send_sol(from: &str, to: &str, amount: u64, signer: &str) -> Result<()> {
    let client = create_connection(LOCAL_RPC_URL);
    let from_pubkey = Pubkey::from_str(from)?;
    let to_pubkey = Pubkey::from_str(to)?;
    let signer_value = serde_json::Value::String(signer.to_string());
    let signer_keypair = parse_keypair(&signer_value, &[])?;

    if signer_keypair.pubkey() != from_pubkey {
        return Err(anyhow!("Signer does not match from pubkey"));
    }
    let blockhash = client.get_latest_blockhash()?;
    let tx = system_transaction::transfer(&signer_keypair, &to_pubkey, amount, blockhash);

    let sig = client.send_and_confirm_transaction(&tx)?;
    println!("Transaction sent: {sig}");

    let parsed_tx = client.get_transaction_with_config(
        &sig,
        RpcTransactionConfig {
            encoding: Some(UiTransactionEncoding::JsonParsed),
            commitment: Some(CommitmentConfig::confirmed()),
            max_supported_transaction_version: Some(0),
        },
    )?;

    if let Some(meta) = parsed_tx.transaction.meta {
        let logs: Option<Vec<String>> = meta.log_messages.into();
        if let Some(logs) = logs {
            for log in logs {
                println!("{log}");
            }
        }
    }

    println!("Sent {} SOL from {from} to {to}", format_amount(amount));
    Ok(())
}

pub fn create_ata(owner: &str, mint: &str, signer: &str) -> Result<()> {
    let raw = RawTransaction {
        instructions: vec![create_ata_tx(owner, mint)],
        signers: vec![serde_json::Value::String(signer.to_string())],
        lookup_tables: None,
    };
    let parsed = parse_tx_from_json(&raw, &[])?;
    execute_json_transaction(parsed, None)
}

pub fn close_ata(owner: &str, mint: &str, signer: &str) -> Result<()> {
    let raw = RawTransaction {
        instructions: vec![close_ata_tx(owner, mint)],
        signers: vec![serde_json::Value::String(signer.to_string())],
        lookup_tables: None,
    };
    let parsed = parse_tx_from_json(&raw, &[])?;
    execute_json_transaction(parsed, None)
}

pub fn get_token_balance(owner: &str, mint: &str) -> Result<()> {
    let client = create_connection(LOCAL_RPC_URL);
    let ata = parse_pubkey(
        &serde_json::json!({
            "type": "ata",
            "owner": owner,
            "mint": mint,
        }),
        &[],
    )?;
    let balance = client.get_token_account_balance(&ata)?;
    let amount = balance
        .ui_amount
        .map(|v| v.to_string())
        .unwrap_or_else(|| balance.ui_amount_string.clone());
    println!(
        "Balance of {owner} for token {mint}: {} tokens",
        format_amount(amount)
    );
    Ok(())
}

pub fn create_lookup_table(accounts_path: &Path, signer: &str) -> Result<()> {
    let data = fs::read_to_string(accounts_path)
        .with_context(|| format!("failed to read {accounts_path:?}"))?;
    let accounts: Vec<String> = serde_json::from_str(&data)
        .with_context(|| format!("invalid JSON in {accounts_path:?}"))?;

    let signer_keypair = parse_keypair(&serde_json::Value::String(signer.to_string()), &[])?;
    let payer_pubkey = signer_keypair.pubkey();
    let client = create_connection(LOCAL_RPC_URL);
    let slot = client.get_slot_with_commitment(CommitmentConfig::finalized())?;
    let recent_slot = slot.saturating_sub(1);

    let (create_ix, table_addr) =
        create_lookup_table_instruction(payer_pubkey, payer_pubkey, recent_slot);
    let addresses = accounts
        .iter()
        .map(|acc| Pubkey::from_str(acc))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| anyhow!("Invalid account in lookup table list"))?;
    let extend_ix = extend_lookup_table(table_addr, payer_pubkey, Some(payer_pubkey), addresses);

    let parsed = ParsedTransaction {
        instructions: vec![create_ix, extend_ix],
        signers: vec![signer_keypair],
        lookup_tables: Vec::new(),
    };
    execute_json_transaction(parsed, None)?;

    println!(
        "Lookup table created at {} with {} accounts",
        table_addr,
        accounts.len()
    );
    Ok(())
}
