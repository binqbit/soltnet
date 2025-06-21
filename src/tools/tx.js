const {
    Connection,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    PublicKey,
    SystemProgram,
} = require('@solana/web3.js');
const { createAtaTx, closeAtaTx } = require('../tx-format/raw-tx.js');
const { parseTxFromJson, parsePubkey, parseKeypair } = require('../tx-format/json-tx.js');
const { formatAmount } = require('../utils.js');

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
    console.log('Total CUs used:', parsedTx.meta.computeUnitsConsumed);
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

async function sendSol(from, to, amount, signer) {
    const connection = createConnection();
    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: new PublicKey(from),
            toPubkey: new PublicKey(to),
            lamports: amount,
        })
    );

    const signers = [parseKeypair(signer)];

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

    console.log(`Sent ${formatAmount(amount)} SOL from ${from} to ${to}`);
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

module.exports = {
    createConnection,
    executeJsonTransaction,
    getBalance,
    airdropSol,
    sendSol,
    createAta,
    closeAta,
    getTokenBalance,
};
