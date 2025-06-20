const {
    COMPUTE_BUDGET_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('./accounts.js');

function setCuLimitTx(limit) {
    return {
        program_id: COMPUTE_BUDGET_PROGRAM_ID.toBase58(),
        accounts: [],
        data: {
            type: 'object',
            data: [
                { type: 'u8', data: 2 },
                { type: 'u32', data: limit },
            ],
        },
    };
}

function createAtaTx(owner, mint, signer) {
    return {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        accounts: [
            {
                "pubkey": owner,
                "is_signer": true,
                "is_writable": true
            },
            {
                "pubkey": {
                    "type": "ata",
                    "owner": owner,
                    "mint": mint
                },
                "is_signer": false,
                "is_writable": true
            },
            {
                "pubkey": owner,
                "is_signer": true,
                "is_writable": true
            },
            {
                "pubkey": mint,
                "is_signer": false,
                "is_writable": false
            },
            {
                "pubkey": SYSTEM_PROGRAM_ID.toBase58(),
                "is_signer": false,
                "is_writable": false
            },
            {
                "pubkey": TOKEN_PROGRAM_ID.toBase58(),
                "is_signer": false,
                "is_writable": false
            }
        ],
        data: 0,
        signers: [signer],
    };
}

function closeAtaTx(owner, mint, signer) {
    return {
        program_id: TOKEN_PROGRAM_ID.toBase58(),
        accounts: [
            {
                "pubkey": {
                    "type": "ata",
                    "owner": owner,
                    "mint": mint
                },
                "is_signer": false,
                "is_writable": true
            },
            {
                "pubkey": owner,
                "is_signer": true,
                "is_writable": true
            },
            {
                "pubkey": owner,
                "is_signer": true,
                "is_writable": true
            }
        ],
        data: {
            type: 'u8',
            data: 9,
        },
        signers: [signer],
    };
}

module.exports = {
    setCuLimitTx,
    createAtaTx,
    closeAtaTx,
};
