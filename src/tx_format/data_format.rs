use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;

use crate::tx_format::{params::resolve_value, pubkey::parse_pubkey};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn parse_u64(value: &Value) -> Result<u64> {
    match value {
        Value::Number(num) => num.as_u64().ok_or_else(|| anyhow!("Invalid numeric value")),
        Value::String(s) => s
            .parse::<u64>()
            .map_err(|_| anyhow!("Invalid numeric string")),
        Value::Bool(b) => Ok(if *b { 1 } else { 0 }),
        _ => Err(anyhow!("Unsupported numeric value")),
    }
}

fn parse_bool(value: &Value) -> Result<bool> {
    match value {
        Value::Bool(b) => Ok(*b),
        Value::String(s) => Ok(s == "true"),
        _ => Err(anyhow!("Unsupported boolean value")),
    }
}

pub fn pack_data(value: &Value, params: &[String]) -> Result<Vec<u8>> {
    let resolved = resolve_value(value, params);

    match resolved {
        Value::Bool(_) => {
            let data = parse_bool(&resolved)?;
            Ok(vec![if data { 1 } else { 0 }])
        }
        Value::Number(_) => {
            let length = parse_u64(&resolved)? as usize;
            Ok(vec![0u8; length])
        }
        Value::String(_) => {
            let data = resolve_value(&resolved, params);
            let data_str = data
                .as_str()
                .ok_or_else(|| anyhow!("Invalid string data"))?;
            if let Some(hex) = data_str.strip_prefix("0x") {
                let bytes = hex::decode(hex).map_err(|_| anyhow!("Invalid hex string"))?;
                Ok(bytes)
            } else {
                let decoded = STANDARD
                    .decode(data_str)
                    .map_err(|_| anyhow!("Invalid base64 string"))?;
                Ok(decoded)
            }
        }
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let item = resolve_value(&item, params);
                let value = match item {
                    Value::Number(num) => {
                        num.as_i64().ok_or_else(|| anyhow!("Invalid array entry"))?
                    }
                    Value::String(s) => s
                        .parse::<i64>()
                        .map_err(|_| anyhow!("Invalid array entry"))?,
                    Value::Bool(b) => {
                        if b {
                            1
                        } else {
                            0
                        }
                    }
                    _ => return Err(anyhow!("Unsupported array entry")),
                };
                out.push(value as u8);
            }
            Ok(out)
        }
        Value::Object(map) => {
            let kind = map
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Missing type in data object"))?;
            match kind {
                "u8" => {
                    let data = map.get("data").ok_or_else(|| anyhow!("Missing data"))?;
                    let value = parse_u64(&resolve_value(data, params))? as u8;
                    Ok(vec![value])
                }
                "u16" => {
                    let data = map.get("data").ok_or_else(|| anyhow!("Missing data"))?;
                    let value = parse_u64(&resolve_value(data, params))? as u16;
                    Ok(value.to_le_bytes().to_vec())
                }
                "u32" => {
                    let data = map.get("data").ok_or_else(|| anyhow!("Missing data"))?;
                    let value = parse_u64(&resolve_value(data, params))? as u32;
                    Ok(value.to_le_bytes().to_vec())
                }
                "u64" => {
                    let data = map.get("data").ok_or_else(|| anyhow!("Missing data"))?;
                    let value = parse_u64(&resolve_value(data, params))?;
                    Ok(value.to_le_bytes().to_vec())
                }
                "pubkey" => {
                    let data = map.get("data").ok_or_else(|| anyhow!("Missing data"))?;
                    let pubkey = parse_pubkey(data, params)?;
                    Ok(pubkey.to_bytes().to_vec())
                }
                "string" | "bytes" => {
                    let data = map.get("data").ok_or_else(|| anyhow!("Missing data"))?;
                    pack_data(data, params)
                }
                "object" => {
                    let data = map.get("data").ok_or_else(|| anyhow!("Missing data"))?;
                    let resolved = resolve_value(data, params);
                    let parsed = if let Value::String(text) = &resolved {
                        if text.trim_start().starts_with('[') || text.trim_start().starts_with('{')
                        {
                            serde_json::from_str::<Value>(text).unwrap_or(resolved)
                        } else {
                            resolved
                        }
                    } else {
                        resolved
                    };

                    let list = parsed
                        .as_array()
                        .ok_or_else(|| anyhow!("Object data must be array"))?;
                    let mut buffer = Vec::new();
                    for entry in list {
                        buffer.extend(pack_data(entry, params)?);
                    }
                    Ok(buffer)
                }
                other => Err(anyhow!("Unsupported data object type: {other}")),
            }
        }
        Value::Null => Ok(Vec::new()),
    }
}

pub fn unpack_data(buffer: &[u8], schema: &Value, offset: usize) -> Result<Value> {
    if let Value::Array(entries) = schema {
        let mut out = Vec::with_capacity(entries.len());
        let mut cursor = offset;
        for entry in entries {
            let res = unpack_data(buffer, entry, cursor)?;
            cursor += get_byte_length(&res)?;
            out.push(res);
        }
        return Ok(Value::Array(out));
    }

    let schema_map = schema
        .as_object()
        .ok_or_else(|| anyhow!("Schema must be object or array"))?;
    let kind = schema_map
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Missing type in schema"))?;

    match kind {
        "u8" => {
            let data = *buffer.get(offset).ok_or_else(|| anyhow!("Out of bounds"))? as u64;
            let mut out = schema_map.clone();
            out.insert("data".to_string(), Value::Number(data.into()));
            Ok(Value::Object(out))
        }
        "u16" => {
            let bytes = buffer
                .get(offset..offset + 2)
                .ok_or_else(|| anyhow!("Out of bounds"))?;
            let data = u16::from_le_bytes([bytes[0], bytes[1]]) as u64;
            let mut out = schema_map.clone();
            out.insert("data".to_string(), Value::Number(data.into()));
            Ok(Value::Object(out))
        }
        "u32" => {
            let bytes = buffer
                .get(offset..offset + 4)
                .ok_or_else(|| anyhow!("Out of bounds"))?;
            let data = u32::from_le_bytes(bytes.try_into().unwrap()) as u64;
            let mut out = schema_map.clone();
            out.insert("data".to_string(), Value::Number(data.into()));
            Ok(Value::Object(out))
        }
        "u64" => {
            let bytes = buffer
                .get(offset..offset + 8)
                .ok_or_else(|| anyhow!("Out of bounds"))?;
            let data = u64::from_le_bytes(bytes.try_into().unwrap());
            let mut out = schema_map.clone();
            let data_value = if data > MAX_SAFE_INTEGER {
                Value::String(data.to_string())
            } else {
                Value::Number(data.into())
            };
            out.insert("data".to_string(), data_value);
            Ok(Value::Object(out))
        }
        "boolean" => {
            let data = buffer.get(offset).ok_or_else(|| anyhow!("Out of bounds"))?;
            let mut out = schema_map.clone();
            out.insert("data".to_string(), Value::Bool(*data != 0));
            Ok(Value::Object(out))
        }
        "pubkey" => {
            let bytes = buffer
                .get(offset..offset + 32)
                .ok_or_else(|| anyhow!("Out of bounds"))?;
            let pubkey = solana_sdk::pubkey::Pubkey::new_from_array(bytes.try_into().unwrap());
            let mut out = schema_map.clone();
            out.insert("data".to_string(), Value::String(pubkey.to_string()));
            Ok(Value::Object(out))
        }
        "bytes" => {
            let size = schema_map
                .get("Size")
                .and_then(Value::as_u64)
                .ok_or_else(|| anyhow!("Missing Size in bytes schema"))?
                as usize;
            let slice = buffer
                .get(offset..offset + size)
                .ok_or_else(|| anyhow!("Out of bounds"))?;
            let data = STANDARD.encode(slice);
            let mut out = schema_map.clone();
            out.insert("size".to_string(), Value::Number((size as u64).into()));
            out.insert("data".to_string(), Value::String(data));
            Ok(Value::Object(out))
        }
        "string" => {
            let len = schema_map
                .get("length")
                .and_then(Value::as_u64)
                .ok_or_else(|| anyhow!("Missing Length in string schema"))?
                as usize;
            let slice = buffer
                .get(offset..offset + len)
                .ok_or_else(|| anyhow!("Out of bounds"))?;
            let data = String::from_utf8_lossy(slice).to_string();
            let mut out = schema_map.clone();
            out.insert("length".to_string(), Value::Number((len as u64).into()));
            out.insert("data".to_string(), Value::String(data));
            Ok(Value::Object(out))
        }
        "object" => {
            let list = schema_map
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow!("Missing object data"))?;
            let mut cursor = offset;
            let mut out_list = Vec::new();
            for entry in list {
                let res = unpack_data(buffer, entry, cursor)?;
                cursor += get_byte_length(&res)?;
                out_list.push(res);
            }
            let mut out = serde_json::Map::new();
            out.insert("type".to_string(), Value::String("object".to_string()));
            if let Some(name) = schema_map.get("name") {
                out.insert("name".to_string(), name.clone());
            }
            out.insert("data".to_string(), Value::Array(out_list));
            Ok(Value::Object(out))
        }
        other => Err(anyhow!("Unknown type: {other}")),
    }
}

pub fn get_byte_length(entry: &Value) -> Result<usize> {
    let map = entry.as_object().ok_or_else(|| anyhow!("Invalid entry"))?;
    let kind = map
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Missing type"))?;
    let len = match kind {
        "u8" => 1,
        "u16" => 2,
        "u32" => 4,
        "u64" => 8,
        "boolean" => 1,
        "pubkey" => 32,
        "bytes" => map
            .get("size")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("Missing size"))? as usize,
        "string" => map
            .get("length")
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("Missing length"))? as usize,
        "object" => {
            let list = map
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow!("Missing object data"))?;
            let mut total = 0;
            for entry in list {
                total += get_byte_length(entry)?;
            }
            total
        }
        other => return Err(anyhow!("Unknown type for byte length: {other}")),
    };
    Ok(len)
}

#[cfg(test)]
mod tests {
    use super::{pack_data, unpack_data};
    use serde_json::json;

    #[test]
    fn pack_and_unpack_roundtrip() {
        let schema = json!({
            "type": "object",
            "name": "payload",
            "data": [
                {"type": "u8", "data": 2},
                {"type": "u16", "data": 500},
                {"type": "u32", "data": 42},
                {"type": "u64", "data": 99}
            ]
        });
        let data = pack_data(&schema, &[]).expect("pack");
        let unpacked = unpack_data(&data, &schema, 0).expect("unpack");
        assert_eq!(
            unpacked,
            json!({
                "type": "object",
                "name": "payload",
                "data": [
                    {"type": "u8", "data": 2},
                    {"type": "u16", "data": 500},
                    {"type": "u32", "data": 42},
                    {"type": "u64", "data": 99}
                ]
            })
        );
    }

    #[test]
    fn pack_object_from_param_string() {
        let params = vec![r#"[{"type":"u8","data":7}]"#.to_string()];
        let data = json!({
            "type": "object",
            "data": "$1"
        });
        let packed = pack_data(&data, &params).expect("pack");
        assert_eq!(packed, vec![7u8]);
    }
}
