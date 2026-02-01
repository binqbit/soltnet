use std::str::FromStr;

use anyhow::{Result, anyhow};
use serde_json::Value;
use solana_sdk::pubkey::Pubkey;

use crate::accounts::{
    ASSOCIATED_TOKEN_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID,
};
use crate::tx_format::params::resolve_value;

pub fn parse_pubkey(value: &Value, params: &[String]) -> Result<Pubkey> {
    match value {
        Value::Object(map) => {
            let kind = map
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Unsupported pubkey object"))?;
            match kind {
                "ata" => {
                    let owner = map
                        .get("owner")
                        .ok_or_else(|| anyhow!("Missing owner for ata"))?;
                    let mint = map
                        .get("mint")
                        .ok_or_else(|| anyhow!("Missing mint for ata"))?;
                    let owner = parse_pubkey(owner, params)?;
                    let mint = parse_pubkey(mint, params)?;
                    let seeds = [owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()];
                    let (ata, _) =
                        Pubkey::find_program_address(&seeds, &ASSOCIATED_TOKEN_PROGRAM_ID);
                    Ok(ata)
                }
                "compute_budget_program" => Ok(COMPUTE_BUDGET_PROGRAM_ID),
                "system_program" => Ok(SYSTEM_PROGRAM_ID),
                "token_program" => Ok(TOKEN_PROGRAM_ID),
                "associated_token_program" => Ok(ASSOCIATED_TOKEN_PROGRAM_ID),
                other => Err(anyhow!("Unsupported pubkey type: {other}")),
            }
        }
        Value::String(_) => {
            let resolved = resolve_value(value, params);
            if resolved != *value {
                return parse_pubkey(&resolved, params);
            }
            let s = resolved
                .as_str()
                .ok_or_else(|| anyhow!("Invalid pubkey value"))?;
            Pubkey::from_str(s).map_err(|err| anyhow!("Invalid pubkey {s}: {err}"))
        }
        _ => Err(anyhow!("Unsupported pubkey value")),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_pubkey;
    use crate::accounts::{ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID};
    use serde_json::json;
    use solana_sdk::pubkey::Pubkey;

    #[test]
    fn parse_pubkey_resolves_params() {
        let params = vec![SYSTEM_PROGRAM_ID.to_string()];
        let pk = parse_pubkey(&json!("$1"), &params).expect("pubkey");
        assert_eq!(pk, SYSTEM_PROGRAM_ID);
    }

    #[test]
    fn parse_pubkey_ata_matches_pda() {
        let owner = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let seeds = [owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()];
        let (expected, _) = Pubkey::find_program_address(&seeds, &ASSOCIATED_TOKEN_PROGRAM_ID);
        let value = json!({
            "type": "ata",
            "owner": owner.to_string(),
            "mint": mint.to_string()
        });
        let derived = parse_pubkey(&value, &[]).expect("ata");
        assert_eq!(derived, expected);
    }
}
