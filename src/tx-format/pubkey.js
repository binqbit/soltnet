const { PublicKey } = require('@solana/web3.js');
const { ASSOCIATED_TOKEN_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } = require('../accounts');

function getParamOrDefault(value, params) {
    for (let param_id = 0; param_id < params.length; param_id++) {
        if (value === `\$${param_id + 1}`) {
            return params[param_id];
        }
    }
    return value;
}

function parsePubkey(pubkey, params = []) {
    if (typeof pubkey === 'object') {
        switch (pubkey.type) {
            case 'ata':
                const owner = parsePubkey(pubkey.owner, params);
                const mint = parsePubkey(pubkey.mint, params);
                return PublicKey.findProgramAddressSync(
                    [
                        owner.toBuffer(),
                        TOKEN_PROGRAM_ID.toBuffer(),
                        mint.toBuffer()
                    ],
                    ASSOCIATED_TOKEN_PROGRAM_ID
                )[0];
            case 'compute_budget_program':
                return COMPUTE_BUDGET_PROGRAM_ID;
            case 'system_program':
                return SYSTEM_PROGRAM_ID;
            case 'token_program':
                return TOKEN_PROGRAM_ID;
            case 'associated_token_program':
                return ASSOCIATED_TOKEN_PROGRAM_ID;
            default:
                throw new Error(`Unsupported pubkey type: ${pubkey.type}`);
        }
    }

    let param = getParamOrDefault(pubkey, params);
    if (param !== pubkey) {
        return parsePubkey(param, params);
    }
    
    return new PublicKey(pubkey);
}

module.exports = {
    parsePubkey,
};
