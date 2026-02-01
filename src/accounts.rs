use solana_sdk::pubkey::Pubkey;

pub const COMPUTE_BUDGET_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("ComputeBudget111111111111111111111111111111");
pub const SYSTEM_PROGRAM_ID: Pubkey = Pubkey::from_str_const("11111111111111111111111111111111");
pub const TOKEN_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
#[allow(dead_code)]
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
#[allow(dead_code)]
pub const LOOKUP_TABLE_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("AddressLookupTab1e1111111111111111111111111");

#[allow(dead_code)]
pub const NATIVE_PROGRAMS: [Pubkey; 6] = [
    COMPUTE_BUDGET_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    LOOKUP_TABLE_PROGRAM_ID,
];
