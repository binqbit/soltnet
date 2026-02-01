fn remove_underscores(s: &str) -> String {
    s.replace('_', "")
}

fn add_underscores(s: &str) -> String {
    let mut parts = Vec::new();
    let mut end = s.len();
    while end > 0 {
        let start = end.saturating_sub(3);
        parts.push(&s[start..end]);
        end = start;
    }
    parts.reverse();
    parts.join("_")
}

fn format_amount_str(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let (sign, raw) = if let Some(stripped) = trimmed.strip_prefix('-') {
        ("-", stripped)
    } else {
        ("", trimmed)
    };

    let raw = remove_underscores(raw);
    if let Some((integer_part, fractional_part)) = raw.split_once('.') {
        format!(
            "{}{}.{}",
            sign,
            add_underscores(integer_part),
            add_underscores(fractional_part)
        )
    } else {
        format!("{}{}", sign, add_underscores(&raw))
    }
}

pub fn format_amount<T: ToString>(value: T) -> String {
    format_amount_str(&value.to_string())
}

#[cfg(test)]
mod tests {
    use super::format_amount;

    #[test]
    fn format_amount_inserts_underscores() {
        assert_eq!(format_amount(0), "0");
        assert_eq!(format_amount(12_345), "12_345");
        assert_eq!(format_amount(123_456_789), "123_456_789");
        assert_eq!(format_amount(-987_654), "-987_654");
    }

    #[test]
    fn format_amount_handles_fractional() {
        assert_eq!(format_amount("1234567.8901"), "1_234_567.8_901");
    }
}
