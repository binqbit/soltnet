const {
    Connection,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    PublicKey,
} = require('@solana/web3.js');
const fs = require('fs');
const { createAtaTx, closeAtaTx } = require('./raw-tx.js');
const { parseTxFromJson, parsePubkey } = require('./json-tx.js');
const { formatAmount } = require('./utils.js');

function createConnection() {
    return new Connection('http://127.0.0.1:8899', 'confirmed');
}

async function executeJsonTransaction(instructions) {
    const connection = createConnection();

    const tx = new Transaction();
    for (const instruction of instructions) {
        tx.add(new TransactionInstruction({
            keys: instruction.accounts,
            programId: instruction.programId,
            data: instruction.data,
        }));
    }

    const signers = [];
    for (const instruction of instructions) {
        for (const signer of instruction.signers) {
            if (!signers.some(s => s.publicKey.equals(signer.publicKey))) {
                signers.push(signer);
            }
        }
    }

    const sig = await sendAndConfirmTransaction(connection, tx, signers, {
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
    await executeJsonTransaction(parseTxFromJson(createAtaTx(owner, mint, signer)));
}

async function closeAta(owner, mint, signer) {
    await executeJsonTransaction(parseTxFromJson(closeAtaTx(owner, mint, signer)));
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

module.exports = {
    executeJsonTransaction,
    getBalance,
    airdropSol,
    createAta,
    closeAta,
    getTokenBalance,
};
