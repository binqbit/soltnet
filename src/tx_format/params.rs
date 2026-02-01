use serde_json::Value;

pub fn param_index(value: &str) -> Option<usize> {
    if let Some(stripped) = value.strip_prefix('$') {
        if let Ok(index) = stripped.parse::<usize>() {
            if index > 0 {
                return Some(index - 1);
            }
        }
    }
    None
}

pub fn resolve_value(value: &Value, params: &[String]) -> Value {
    if let Value::String(s) = value {
        if let Some(index) = param_index(s) {
            if let Some(param) = params.get(index) {
                return Value::String(param.clone());
            }
        }
    }
    value.clone()
}
