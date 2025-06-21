const {
    Connection,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    PublicKey,
} = require('@solana/web3.js');
const { exec } = require('child_process');
const fs = require('fs');
const { createAtaTx, closeAtaTx } = require('./raw-tx.js');
const { parseTxFromJson, parsePubkey, loadTxFromJson } = require('./json-tx.js');
const { parseTxToJson } = require('./parse-tx.js');
const { formatAmount } = require('./utils.js');
const path = require('path');

function createConnection(network = 'http://127.0.0.1:8899') {
    return new Connection(network, 'confirmed');
}

async function executeJsonTransaction(jsonTx) {
    const connection = createConnection();

    const tx = new Transaction();
    for (const instruction of jsonTx.instructions) {
        tx.add(new TransactionInstruction({
            programId: instruction.programId,
            data: instruction.data,
            keys: instruction.accounts,
        }));
    }

    const sig = await sendAndConfirmTransaction(connection, tx, jsonTx.signers, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
    });
    console.log('Transaction sent:', sig);

    const parsedTx = await connection.getParsedTransaction(sig, { commitment: 'confirmed' });
    const logs = parsedTx.meta.logMessages || [];
    logs.forEach(log => {
        console.log(log);
    });
}

async function getBalance(address) {
    const connection = createConnection();
    const balance = await connection.getBalance(new PublicKey(address));
    console.log(`Balance of ${address}: ${formatAmount(balance)} lamports`);
}

async function airdropSol(address, amount) {
    const connection = createConnection();
    const tx = await connection.requestAirdrop(new PublicKey(address), amount);
    const res = await connection.confirmTransaction(tx, 'confirmed');
    if (res.value.err) {
        throw new Error(`Airdrop failed: ${res.value.err}`);
    } else {
        console.log(`Airdrop successful: ${formatAmount(amount)} SOL to ${address}`);
    }
}

async function createAta(owner, mint, signer) {
    await executeJsonTransaction(parseTxFromJson({
        instructions: [createAtaTx(owner, mint)],
        signers: [signer],
    }));
}

async function closeAta(owner, mint, signer) {
    await executeJsonTransaction(parseTxFromJson({
        instructions: [closeAtaTx(owner, mint)],
        signers: [signer],
    }));
}

async function getTokenBalance(address, mint) {
    const connection = createConnection();
    const ata = parsePubkey({
        type: 'ata',
        owner: address,
        mint: mint,
    });
    const balance = await connection.getTokenAccountBalance(ata);
    console.log(`Balance of ${address} for token ${mint}: ${formatAmount(balance.value.uiAmount)} tokens`);
}

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

module.exports = {
    executeJsonTransaction,
    getBalance,
    airdropSol,
    createAta,
    closeAta,
    getTokenBalance,
    dumpAccount,
    dumpAccountsFromTx,
    dumpAccountsForTx,
    createJsonFromTx,
};
