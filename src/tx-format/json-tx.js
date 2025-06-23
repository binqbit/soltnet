const {
    Keypair,
    PublicKey,
} = require('@solana/web3.js');
const fs = require('fs');
const { setCuLimitTx, createAtaTx, closeAtaTx, transferTx } = require('./raw-tx.js');
const { packData } = require('./data-format.js');
const { parsePubkey } = require('./pubkey.js');

function getParamOrDefault(value, params) {
    for (let param_id = 0; param_id < params.length; param_id++) {
        if (value === `\$${param_id + 1}`) {
            return params[param_id];
        }
    }
    return value;
}

function parseKeypair(keypair, params = []) {
    keypair = getParamOrDefault(keypair, params);
    if (typeof keypair === 'string') {
        keypair = fs.readFileSync(keypair, 'utf8');
        keypair = JSON.parse(keypair);
    }
    return Keypair.fromSecretKey(Uint8Array.from(keypair));
}

function parseIxFromJson(ix, params = []) {
    switch (ix.program_id) {
        case 'set_cu_limit':
            return parseIxFromJson(setCuLimitTx(ix.limit), params);
        case 'transfer':
            return parseIxFromJson(transferTx(ix.from, ix.to, ix.amount), params);
        case 'create_ata':
            return parseIxFromJson(createAtaTx(ix.owner, ix.mint), params);
        case 'close_ata':
            return parseIxFromJson(closeAtaTx(ix.owner, ix.mint), params);
        default:
            return {
                programId: new PublicKey(ix.program_id),
                accounts: ix.accounts ? ix.accounts.map(acc => ({
                    pubkey: parsePubkey(acc.pubkey, params),
                    isSigner: acc.is_signer,
                    isWritable: acc.is_writable,
                })) : [],
                data: packData(ix.data, params),
            };
    }
}

function parseTxFromJson(tx, params = []) {
    return {
        instructions: tx.instructions.map(ix => parseIxFromJson(ix, params)),
        signers: tx.signers.map(signer => parseKeypair(signer, params)),
    };
}

function loadTxFromJson(filePath, params = [], isParsed = true) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const tx = JSON.parse(data);
        if (isParsed) {
            return parseTxFromJson(tx, params);
        } else {
            return tx;
        }
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        throw error;
    }
}

module.exports = {
    parsePubkey,
    parseKeypair,
    parseTxFromJson,
    loadTxFromJson,
};
