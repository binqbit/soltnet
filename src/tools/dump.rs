use std::{collections::HashSet, fs, path::Path, str::FromStr};

use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use solana_commitment_config::CommitmentConfig;
use solana_rpc_client::api::config::RpcTransactionConfig;
use solana_sdk::pubkey::Pubkey;
use solana_transaction_status::{EncodedTransaction, UiMessage, UiTransactionEncoding};

use crate::tools::tx::{MAINNET_RPC_URL, create_connection};
use crate::tx_format::json_tx::load_parsed_tx_from_json;

const UPGRADEABLE_LOADER_ID: Pubkey =
    Pubkey::from_str_const("BPFLoaderUpgradeab1e11111111111111111111111");
const ELF_MAGIC: [u8; 4] = [0x7f, 0x45, 0x4c, 0x46];

fn extract_elf_bytes(data: &[u8]) -> Option<Vec<u8>> {
    data.windows(ELF_MAGIC.len())
        .position(|window| window == ELF_MAGIC)
        .map(|idx| data[idx..].to_vec())
}

fn try_get_upgradeable_program_data_address(data: &[u8]) -> Option<Pubkey> {
    if data.len() < 4 + 32 {
        return None;
    }
    let tag = u32::from_le_bytes(data[0..4].try_into().ok()?);
    if tag != 2 {
        return None;
    }
    Some(Pubkey::new_from_array(data[4..36].try_into().ok()?))
}

fn serialize_account_info(
    pubkey: &Pubkey,
    account: &solana_sdk::account::Account,
) -> serde_json::Value {
    serde_json::json!({
        "pubkey": pubkey.to_string(),
        "account": {
            "lamports": account.lamports,
            "data": [STANDARD.encode(&account.data), "base64"],
            "owner": account.owner.to_string(),
            "executable": account.executable,
            "rentEpoch": account.rent_epoch,
            "space": account.data.len(),
        }
    })
}

pub fn dump_account(address: &str, to_path: impl AsRef<Path>) -> Result<()> {
    fs::create_dir_all(&to_path)?;

    let connection = create_connection(MAINNET_RPC_URL);
    let pubkey = Pubkey::from_str(address).map_err(|_| anyhow!("Invalid pubkey: {address}"))?;
    let account = connection
        .get_account(&pubkey)
        .with_context(|| format!("Account not found: {address}"))?;

    if account.executable {
        println!("Dumping program {address}...");
        let mut program_data = account.data.clone();
        if account.owner == UPGRADEABLE_LOADER_ID {
            if let Some(program_data_address) =
                try_get_upgradeable_program_data_address(&account.data)
            {
                if let Ok(program_data_info) = connection.get_account(&program_data_address) {
                    program_data = program_data_info.data;
                }
            }
        }

        let elf_bytes = extract_elf_bytes(&program_data)
            .ok_or_else(|| anyhow!("Program data not found or not ELF for: {address}"))?;
        let out_path = to_path.as_ref().join(format!("{address}.so"));
        fs::write(&out_path, elf_bytes)?;
        println!("Program dumped to {}", out_path.display());
    } else {
        println!("Dumping account {address}...");
        let payload = serialize_account_info(&pubkey, &account);
        let out_path = to_path.as_ref().join(format!("{address}.json"));
        fs::write(&out_path, serde_json::to_string_pretty(&payload)?)?;
        println!("Account dumped to {}", out_path.display());
    }

    Ok(())
}

fn add_account(set: &mut HashSet<String>, account: &str) {
    if !account.is_empty() {
        set.insert(account.to_string());
    }
}

pub fn dump_accounts_from_tx(signature: &str, to_path: impl AsRef<Path>) -> Result<()> {
    let connection = create_connection(MAINNET_RPC_URL);
    let config = RpcTransactionConfig {
        encoding: Some(UiTransactionEncoding::JsonParsed),
        commitment: Some(CommitmentConfig::confirmed()),
        max_supported_transaction_version: Some(0),
    };
    let tx = connection
        .get_transaction_with_config(&signature.parse()?, config)
        .with_context(|| format!("Transaction not found: {signature}"))?;

    let mut accounts = HashSet::new();
    let message = match &tx.transaction.transaction {
        EncodedTransaction::Json(tx) => &tx.message,
        _ => return Err(anyhow!("Transaction encoding is not JSON")),
    };

    match message {
        UiMessage::Parsed(msg) => {
            for key in &msg.account_keys {
                add_account(&mut accounts, &key.pubkey);
            }
        }
        UiMessage::Raw(msg) => {
            for key in &msg.account_keys {
                add_account(&mut accounts, key);
            }
        }
    }

    if let Some(meta) = tx.transaction.meta {
        let loaded_addresses: Option<solana_transaction_status::UiLoadedAddresses> =
            meta.loaded_addresses.into();
        if let Some(loaded) = loaded_addresses {
            for key in loaded.writable.iter().chain(loaded.readonly.iter()) {
                add_account(&mut accounts, key);
            }
        }

        let token_balances: Vec<solana_transaction_status::UiTransactionTokenBalance> =
            Option::<Vec<_>>::from(meta.pre_token_balances)
                .unwrap_or_default()
                .into_iter()
                .chain(
                    Option::<Vec<_>>::from(meta.post_token_balances)
                        .unwrap_or_default()
                        .into_iter(),
                )
                .collect();

        for balance in token_balances {
            add_account(&mut accounts, &balance.mint);
            if let Some(owner) = Option::<String>::from(balance.owner) {
                add_account(&mut accounts, &owner);
            }
        }
    }

    for account in accounts {
        if let Err(error) = dump_account(&account, &to_path) {
            eprintln!("Failed to dump account {account}: {error}");
        }
    }

    Ok(())
}

pub fn dump_accounts_for_tx(
    path: impl AsRef<Path>,
    to_path: impl AsRef<Path>,
    params: &[String],
) -> Result<()> {
    let tx = load_parsed_tx_from_json(&path, params)?;

    let mut accounts = HashSet::new();
    for instruction in tx.instructions {
        for account in instruction.accounts {
            add_account(&mut accounts, &account.pubkey.to_string());
        }
    }

    for account in accounts {
        if let Err(error) = dump_account(&account, &to_path) {
            eprintln!("Failed to dump account {account}: {error}");
        }
    }

    Ok(())
}

pub fn dump_raw_transaction(signature: &str, to_path: impl AsRef<Path>) -> Result<()> {
    let connection = create_connection(MAINNET_RPC_URL);
    let config = RpcTransactionConfig {
        encoding: Some(UiTransactionEncoding::JsonParsed),
        commitment: Some(CommitmentConfig::confirmed()),
        max_supported_transaction_version: Some(0),
    };
    let tx = connection
        .get_transaction_with_config(&signature.parse()?, config)
        .with_context(|| format!("Transaction not found: {signature}"))?;

    fs::create_dir_all(&to_path)?;
    let file_path = to_path.as_ref().join(format!("{signature}.json"));
    fs::write(&file_path, serde_json::to_string_pretty(&tx)?)?;
    println!("Raw transaction dumped to {}", file_path.display());
    Ok(())
}

pub fn dump_raw_block(slot: &str, to_path: impl AsRef<Path>) -> Result<()> {
    let connection = create_connection(MAINNET_RPC_URL);
    let slot_num: u64 = slot.parse().map_err(|_| anyhow!("Invalid slot: {slot}"))?;

    let config = solana_rpc_client::api::config::RpcBlockConfig {
        encoding: Some(UiTransactionEncoding::JsonParsed),
        transaction_details: Some(solana_transaction_status::TransactionDetails::Full),
        rewards: Some(true),
        commitment: Some(CommitmentConfig::confirmed()),
        max_supported_transaction_version: Some(0),
    };

    let block = connection
        .get_block_with_config(slot_num, config)
        .with_context(|| format!("Block not found: {slot}"))?;

    fs::create_dir_all(&to_path)?;
    let file_path = to_path.as_ref().join(format!("{slot_num}.json"));
    fs::write(&file_path, serde_json::to_string_pretty(&block)?)?;
    println!("Raw block dumped to {}", file_path.display());
    Ok(())
}
