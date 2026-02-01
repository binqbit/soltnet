use std::path::Path;

use anyhow::{Context, Result, anyhow};
use serde_json::Value;

use crate::tx_format::{
    RawTransaction, data_format::pack_data, data_format::unpack_data,
    json_tx::load_raw_tx_from_json,
};

pub fn set_data_format(
    tx_path: impl AsRef<Path>,
    format_path: impl AsRef<Path>,
    program_id: &str,
) -> Result<()> {
    let mut tx: RawTransaction = load_raw_tx_from_json(&tx_path)?;
    let data_format: Value = serde_json::from_str(
        &std::fs::read_to_string(&format_path)
            .with_context(|| format!("failed to read {:?}", format_path.as_ref()))?,
    )
    .with_context(|| format!("invalid JSON in {:?}", format_path.as_ref()))?;

    for instruction in &mut tx.instructions {
        if instruction.program_id == program_id {
            let data = pack_data(&instruction.data, &[])?;
            instruction.data = unpack_data(&data, &data_format, 0)?;
            let json = serde_json::to_string_pretty(&tx)?;
            std::fs::write(&tx_path, json)
                .with_context(|| format!("failed to write {:?}", tx_path.as_ref()))?;
            println!("Updated data format for instruction in program {program_id}");
            return Ok(());
        }
    }

    Err(anyhow!(
        "Program ID {program_id} not found in transaction instructions."
    ))
}
