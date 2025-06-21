const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

const { createConnection } = require("./tx.js");
const { unpackData, packData } = require("../tx-format/data-format.js");
const { loadTxFromJson } = require("../tx-format/json-tx.js");
const { parseTxToJson } = require("../tx-format/parse-tx.js");


async function dumpAccount(address, toPath) {
    if (!fs.existsSync(toPath)) {
        fs.mkdirSync(toPath, { recursive: true });
    }

    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const accountInfo = await connection.getAccountInfo(new PublicKey(address));
    if (!accountInfo) {
        throw new Error(`Account not found: ${address}`);
    }
    if (accountInfo.executable) {
        console.log(`Dumping program ${address}...`);
        exec(`solana program dump ${address} ${path.join(toPath, `${address}.so`)}`, (error, stdout, stderr) => {
            stderr && console.error(stderr);
        });
    } else {
        console.log(`Dumping account ${address}...`);
        exec(`solana account --output json ${address} > ${path.join(toPath, `${address}.json`)}`, (error, stdout, stderr) => {
            stderr && console.error(stderr);
        });
    }
}

async function dumpAccountsFromTx(signature, toPath) {
    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed' });
    if (!tx) {
        throw new Error(`Transaction not found: ${signature}`);
    }

    const accounts = new Set();
    tx.transaction.message.accountKeys.forEach(account => {
        accounts.add(account.toBase58());
    });

    for (const account of accounts) {
        try {
            await dumpAccount(account, toPath);
        } catch (error) {
            console.error(`Failed to dump account ${account}:`, error.message);
        }
    }
}

async function dumpAccountsForTx(path, toPath, params = []) {
    const tx = loadTxFromJson(path, params);

    const accounts = new Set();
    tx.forEach(instruction => {
        instruction.accounts.forEach(account => {
            accounts.add(account.pubkey.toBase58());
        });
    });

    for (const account of accounts) {
        try {
            await dumpAccount(account, toPath);
        } catch (error) {
            console.error(`Failed to dump account ${account}:`, error.message);
        }
    }
}

async function createJsonFromTx(signature, toPath) {
    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const tx = await connection.getParsedTransaction(signature, { commitment: 'confirmed' });
    if (!tx) {
        throw new Error(`Transaction not found: ${signature}`);
    }

    console.log(`Parsing transaction ${signature}...`);
    const json = JSON.stringify(parseTxToJson(tx), null, '\t');
    fs.writeFileSync(path.join(toPath, `${signature}.json`), json);
    console.log(`Transaction dumped to ${path.join(toPath, `${signature}.json`)}`);
}

function setDataFormat(txPath, formatPath, programId) {
    const tx = loadTxFromJson(txPath, [], false);
    const dataFormat = JSON.parse(fs.readFileSync(formatPath, 'utf8'));

    for (const instruction of tx.instructions) {
        if (instruction.program_id === programId) {
            const data = packData(instruction.data);
            instruction.data = unpackData(data, dataFormat);
            fs.writeFileSync(txPath, JSON.stringify(tx, null, '\t'));
            console.log(`Updated data format for instruction in program ${programId}`);
            return;
        }
    }

    console.error(`Program ID ${programId} not found in transaction instructions.`);
}

module.exports = {
    dumpAccount,
    dumpAccountsFromTx,
    dumpAccountsForTx,
    createJsonFromTx,
    setDataFormat,
};
