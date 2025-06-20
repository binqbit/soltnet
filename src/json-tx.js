const {
    Keypair,
    PublicKey,
} = require('@solana/web3.js');
const fs = require('fs');
const {
    COMPUTE_BUDGET_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('./accounts.js');
const { setCuLimitTx, createAtaTx } = require('./raw-tx.js');

function parsePubkey(pubkey) {
    if (typeof pubkey === 'object') {
        switch (pubkey.type) {
            case 'ata':
                const owner = new PublicKey(pubkey.owner);
                const mint = new PublicKey(pubkey.mint);
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
    return new PublicKey(pubkey);
}

function parseKeypair(keypair) {
    return Keypair.fromSecretKey(Uint8Array.from(keypair));
}

function parseData(data) {
    switch (typeof data) {
        case 'boolean':
            return Buffer.from([data ? 1 : 0]);
        case 'number':
            return Buffer.from(new Uint8Array(new Array(data).fill(0)));
        case 'string':
            if (data.startsWith('0x')) {
                return Buffer.from(data.slice(2), 'hex');
            } else {
                return Buffer.from(data, 'base64');
            }
        case 'array':
        case 'object':
            if (Array.isArray(data)) {
                return Buffer.from(new Uint8Array(data));
            } else {
                let buffer = Buffer.alloc(0);
                switch (data.type) {
                    case 'u8':
                        const u8Buffer = Buffer.alloc(1);
                        u8Buffer.writeUInt8(data.data, 0);
                        buffer = Buffer.concat([buffer, u8Buffer]);
                        break;
                    case 'u16':
                        const u16Buffer = Buffer.alloc(2);
                        u16Buffer.writeUInt16LE(data.data, 0);
                        buffer = Buffer.concat([buffer, u16Buffer]);
                        break;
                    case 'u32':
                        const u32Buffer = Buffer.alloc(4);
                        u32Buffer.writeUInt32LE(data.data, 0);
                        buffer = Buffer.concat([buffer, u32Buffer]);
                        break;
                    case 'u64':
                        const u64Buffer = Buffer.alloc(8);
                        u64Buffer.writeBigUInt64LE(BigInt(data.data), 0);
                        buffer = Buffer.concat([buffer, u64Buffer]);
                        break;
                    case 'pubkey':
                        buffer = Buffer.concat([buffer, parsePubkey(data.data).toBuffer()]);
                        break;
                    case 'string':
                        buffer = Buffer.concat([buffer, parseData(data.data)]);
                        break;
                    case 'bytes':
                        buffer = Buffer.concat([buffer, parseData(data.data)]);
                        break;
                    case 'object':
                        for (const item of data.data) {
                            buffer = Buffer.concat([buffer, parseData(item)]);
                        }
                        break;
                }
                return buffer;
            }
        default:
            throw new Error(`Unsupported data type: ${typeof data}`);
    }
}

function parseTxFromJson(json) {
    if (Array.isArray(json)) {
        return json.map(tx => parseTxFromJson(tx)[0]);
    }

    if (json.program_id === "set_cu_limit") {
        return parseTxFromJson(setCuLimitTx(json.limit));
    }

    if (json.program_id === "create_ata") {
        return parseTxFromJson(createAtaTx(json.owner, json.mint, json.signer));
    }

    return [{
        programId: new PublicKey(json.program_id),
        accounts: json.accounts ? json.accounts.map(acc => ({
            pubkey: parsePubkey(acc.pubkey),
            isSigner: acc.is_signer,
            isWritable: acc.is_writable,
        })) : [],
        data: parseData(json.data),
        signers: json.signers ? json.signers.map(parseKeypair) : [],
    }];
}

function loadTxFromJson(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return parseTxFromJson(JSON.parse(data));
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        throw error;
    }
}

module.exports = {
    parsePubkey,
    parseKeypair,
    parseData,
    parseTxFromJson,
    loadTxFromJson,
};
