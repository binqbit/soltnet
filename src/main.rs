mod accounts;
mod config;
mod tools;
mod tx_format;
mod utils;

use std::path::PathBuf;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};

use crate::config::{set_testnet_config, start_testnet_container, stop_testnet_container};
use crate::tools::{
    data_format::set_data_format,
    dump::{
        dump_account, dump_accounts_for_tx, dump_accounts_from_tx, dump_raw_block,
        dump_raw_transaction,
    },
    parse::{create_json_from_tx, parse_block},
    tx::{
        airdrop_sol, close_ata, create_ata, create_lookup_table, execute_json_transaction,
        get_balance, get_token_balance, send_sol,
    },
};
use crate::tx_format::json_tx::load_parsed_tx_from_json;

#[derive(Parser)]
#[command(name = "soltnet", version, about = "Solana Testnet Tool")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Copy accounts/programs into the local testnet config
    Load { accounts_path: PathBuf },
    /// Clear the local testnet configuration
    Clear,
    /// Start the local testnet container
    Start,
    /// Stop the local testnet container
    Stop,
    /// Execute a transaction described in JSON
    ExecTx {
        tx_json: PathBuf,
        params: Vec<String>,
    },
    /// Retrieve SOL balance for an account
    Balance { pubkey: String },
    /// Request an airdrop of SOL
    Airdrop {
        pubkey: String,
        amount_sol: Option<String>,
    },
    /// Transfer SOL between two accounts
    SendSol {
        from: String,
        to: String,
        amount_lamports: String,
        signer_keypair: String,
    },
    /// Create an associated token account
    CreateAta {
        owner: String,
        mint: String,
        signer_keypair: String,
    },
    /// Close an associated token account
    CloseAta {
        owner: String,
        mint: String,
        signer_keypair: String,
    },
    /// Retrieve SPL token balance for an account
    TokenBalance { owner: String, mint: String },
    /// Create an address lookup table using accounts JSON
    CreateLookupTable {
        accounts_json: PathBuf,
        signer_keypair: String,
    },
    /// Dump account or program data from mainnet
    Dump {
        pubkey: String,
        output_path: Option<PathBuf>,
    },
    /// Dump all accounts touched by a transaction
    DumpFromTx {
        signature: String,
        output_path: Option<PathBuf>,
    },
    /// Dump all accounts required by a transaction template
    DumpForTx {
        tx_json: PathBuf,
        output_path: Option<PathBuf>,
        params: Vec<String>,
    },
    /// Fetch a transaction and store its JSON representation
    ParseTx {
        signature: String,
        output_path: Option<PathBuf>,
    },
    /// Parse/analyze a block by slot (accounts, balances, instructions)
    ParseBlock {
        slot: String,
        output_path: Option<PathBuf>,
    },
    /// Fetch a raw transaction response and store it as JSON
    DumpTx {
        signature: String,
        output_path: Option<PathBuf>,
    },
    /// Fetch a raw block response and store it as JSON
    DumpBlock {
        slot: String,
        output_path: Option<PathBuf>,
    },
    /// Apply a data format to an instruction inside a transaction JSON
    SetDataFormat {
        tx_json: PathBuf,
        format_json: PathBuf,
        program_id: String,
    },
}

fn parse_sol_to_lamports(input: &str) -> Result<u64> {
    let cleaned = input.trim().replace('_', "");
    if cleaned.is_empty() {
        return Err(anyhow!("Invalid amount: empty string"));
    }
    if cleaned.starts_with('-') {
        return Err(anyhow!("Amount must be non-negative"));
    }

    let mut parts = cleaned.split('.');
    let whole_str = parts.next().unwrap_or("");
    let frac_str = parts.next().unwrap_or("");
    if parts.next().is_some() {
        return Err(anyhow!("Invalid amount: too many decimal points"));
    }

    if !whole_str.is_empty() && !whole_str.chars().all(|c| c.is_ascii_digit()) {
        return Err(anyhow!("Invalid amount: {input}"));
    }
    if !frac_str.is_empty() && !frac_str.chars().all(|c| c.is_ascii_digit()) {
        return Err(anyhow!("Invalid amount: {input}"));
    }
    if frac_str.len() > 9 {
        return Err(anyhow!("Invalid amount: max 9 decimal places"));
    }

    let whole: u64 = if whole_str.is_empty() {
        0
    } else {
        whole_str.parse()?
    };

    let mut frac_padded = frac_str.to_string();
    while frac_padded.len() < 9 {
        frac_padded.push('0');
    }
    let frac: u64 = if frac_padded.is_empty() {
        0
    } else {
        frac_padded.parse()?
    };

    let lamports = whole
        .checked_mul(1_000_000_000)
        .and_then(|v| v.checked_add(frac))
        .ok_or_else(|| anyhow!("Amount is too large"))?;

    Ok(lamports)
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Load { accounts_path } => set_testnet_config(Some(&accounts_path))?,
        Commands::Clear => set_testnet_config(None)?,
        Commands::Start => start_testnet_container()?,
        Commands::Stop => stop_testnet_container()?,
        Commands::ExecTx { tx_json, params } => {
            let parsed = load_parsed_tx_from_json(&tx_json, &params)?;
            execute_json_transaction(parsed, None)?;
        }
        Commands::Balance { pubkey } => get_balance(&pubkey)?,
        Commands::Airdrop { pubkey, amount_sol } => {
            let amount = amount_sol.unwrap_or_else(|| "1".to_string());
            let lamports = parse_sol_to_lamports(&amount)?;
            airdrop_sol(&pubkey, lamports)?;
        }
        Commands::SendSol {
            from,
            to,
            amount_lamports,
            signer_keypair,
        } => {
            let lamports: u64 = amount_lamports.replace('_', "").parse()?;
            send_sol(&from, &to, lamports, &signer_keypair)?;
        }
        Commands::CreateAta {
            owner,
            mint,
            signer_keypair,
        } => create_ata(&owner, &mint, &signer_keypair)?,
        Commands::CloseAta {
            owner,
            mint,
            signer_keypair,
        } => close_ata(&owner, &mint, &signer_keypair)?,
        Commands::TokenBalance { owner, mint } => get_token_balance(&owner, &mint)?,
        Commands::CreateLookupTable {
            accounts_json,
            signer_keypair,
        } => create_lookup_table(&accounts_json, &signer_keypair)?,
        Commands::Dump {
            pubkey,
            output_path,
        } => {
            let out = output_path.unwrap_or_else(|| PathBuf::from("."));
            dump_account(&pubkey, out)?;
        }
        Commands::DumpFromTx {
            signature,
            output_path,
        } => {
            let out = output_path.unwrap_or_else(|| PathBuf::from("."));
            dump_accounts_from_tx(&signature, out)?;
        }
        Commands::DumpForTx {
            tx_json,
            output_path,
            params,
        } => {
            let out = output_path.unwrap_or_else(|| PathBuf::from("."));
            dump_accounts_for_tx(tx_json, out, &params)?;
        }
        Commands::ParseTx {
            signature,
            output_path,
        } => {
            let out = output_path.unwrap_or_else(|| PathBuf::from("."));
            create_json_from_tx(&signature, out)?;
        }
        Commands::ParseBlock { slot, output_path } => {
            let out = output_path.unwrap_or_else(|| PathBuf::from("."));
            parse_block(&slot, out)?;
        }
        Commands::DumpTx {
            signature,
            output_path,
        } => {
            let out = output_path.unwrap_or_else(|| PathBuf::from("."));
            dump_raw_transaction(&signature, out)?;
        }
        Commands::DumpBlock { slot, output_path } => {
            let out = output_path.unwrap_or_else(|| PathBuf::from("."));
            dump_raw_block(&slot, out)?;
        }
        Commands::SetDataFormat {
            tx_json,
            format_json,
            program_id,
        } => set_data_format(tx_json, format_json, &program_id)?,
    }

    Ok(())
}
