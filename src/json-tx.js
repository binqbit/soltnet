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

function parseKeypair(keypair, params = []) {
    keypair = getParamOrDefault(keypair, params);
    if (typeof keypair === 'string') {
        keypair = fs.readFileSync(keypair, 'utf8');
        keypair = JSON.parse(keypair);
    }
    return Keypair.fromSecretKey(Uint8Array.from(keypair));
}

function parseData(data, params = []) {
    switch (typeof data) {
        case 'boolean':
            data = getParamOrDefault(data, params);
            if (typeof data !== 'boolean') {
                data = data === 'true';
            }
            return Buffer.from([data ? 1 : 0]);
        case 'number':
            data = getParamOrDefault(data, params);
            if (typeof data !== 'number') {
                data = parseInt(data);
            }
            return Buffer.from(new Uint8Array(new Array(data).fill(0)));
        case 'string':
            data = getParamOrDefault(data, params);
            if (data.startsWith('0x')) {
                return Buffer.from(data.slice(2), 'hex');
            } else {
                return Buffer.from(data, 'base64');
            }
        case 'array':
        case 'object':
            data = getParamOrDefault(data, params);
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }
            if (Array.isArray(data)) {
                for (let i = 0; i < data.length; i++) {
                    value = parseData(data[i], params);
                    if (typeof value === 'string') {
                        value = parseInt(value);
                    }
                    data[i] = value;
                }
                return Buffer.from(new Uint8Array(data));
            } else {
                let buffer = Buffer.alloc(0);
                switch (data.type) {
                    case 'u8':
                        data.data = getParamOrDefault(data.data, params);
                        if (typeof data.data === 'string') {
                            data.data = parseInt(data.data);
                        }
                        const u8Buffer = Buffer.alloc(1);
                        u8Buffer.writeUInt8(data.data, 0);
                        buffer = Buffer.concat([buffer, u8Buffer]);
                        break;
                    case 'u16':
                        data.data = getParamOrDefault(data.data, params);
                        if (typeof data.data === 'string') {
                            data.data = parseInt(data.data);
                        }
                        const u16Buffer = Buffer.alloc(2);
                        u16Buffer.writeUInt16LE(data.data, 0);
                        buffer = Buffer.concat([buffer, u16Buffer]);
                        break;
                    case 'u32':
                        data.data = getParamOrDefault(data.data, params);
                        if (typeof data.data === 'string') {
                            data.data = parseInt(data.data);
                        }
                        const u32Buffer = Buffer.alloc(4);
                        u32Buffer.writeUInt32LE(data.data, 0);
                        buffer = Buffer.concat([buffer, u32Buffer]);
                        break;
                    case 'u64':
                        data.data = getParamOrDefault(data.data, params);
                        if (typeof data.data === 'string') {
                            data.data = parseInt(data.data);
                        }
                        const u64Buffer = Buffer.alloc(8);
                        u64Buffer.writeBigUInt64LE(BigInt(data.data), 0);
                        buffer = Buffer.concat([buffer, u64Buffer]);
                        break;
                    case 'pubkey':
                        buffer = Buffer.concat([buffer, parsePubkey(data.data, params).toBuffer()]);
                        break;
                    case 'string':
                        buffer = Buffer.concat([buffer, parseData(data.data, params)]);
                        break;
                    case 'bytes':
                        buffer = Buffer.concat([buffer, parseData(data.data, params)]);
                        break;
                    case 'object':
                        for (const item of data.data) {
                            buffer = Buffer.concat([buffer, parseData(item, params)]);
                        }
                        break;
                }
                return buffer;
            }
        default:
            throw new Error(`Unsupported data type: ${typeof data}`);
    }
}

function parseTxFromJson(json, params = []) {
    if (Array.isArray(json)) {
        return json.map(tx => parseTxFromJson(tx, params)[0]);
    }

    if (json.program_id === "set_cu_limit") {
        return parseTxFromJson(setCuLimitTx(json.limit), params);
    }

    if (json.program_id === "create_ata") {
        return parseTxFromJson(createAtaTx(json.owner, json.mint, json.signer), params);
    }

    return [{
        programId: new PublicKey(json.program_id),
        accounts: json.accounts ? json.accounts.map(acc => ({
            pubkey: parsePubkey(acc.pubkey, params),
            isSigner: acc.is_signer,
            isWritable: acc.is_writable,
        })) : [],
        data: parseData(json.data, params),
        signers: json.signers ? json.signers.map(signer => parseKeypair(signer, params)) : [],
    }];
}

function loadTxFromJson(filePath, params = []) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return parseTxFromJson(JSON.parse(data), params);
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
