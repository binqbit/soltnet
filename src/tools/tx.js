const {
    Connection,
    Transaction,
    TransactionMessage,
    TransactionInstruction,
    VersionedTransaction,
    sendAndConfirmTransaction,
    PublicKey,
    SystemProgram,
    AddressLookupTableProgram,
} = require('@solana/web3.js');
const fs = require('fs');
const { createAtaTx, closeAtaTx } = require('../tx-format/raw-tx.js');
const { parseTxFromJson, parsePubkey, parseKeypair } = require('../tx-format/json-tx.js');
const { formatAmount } = require('../utils.js');

function createConnection(network = 'http://127.0.0.1:8899') {
    return new Connection(network, 'confirmed');
}

async function executeJsonTransaction(jsonTx, payerPubkey) {
    const connection = createConnection();
    const payer = payerPubkey ? new PublicKey(payerPubkey) : jsonTx.signers[0].publicKey;

    let altAccounts = [];
    if (jsonTx.lookupTables?.length) {
        altAccounts = await Promise.all(
            jsonTx.lookupTables.map(async (key) => {
                const { value } = await connection.getAddressLookupTable(
                    new PublicKey(key),
                );
                if (!value) throw new Error(`ALT ${key} not found / not active`);
                return value;
            }),
        );
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const instructions = jsonTx.instructions.map((ix) =>
        ix instanceof TransactionInstruction ? ix : new TransactionInstruction(ix),
    );

    const message =
        altAccounts.length === 0
            ? new TransactionMessage({
                payerKey: payer,
                recentBlockhash: blockhash,
                instructions,
            }).compileToLegacyMessage()
            : new TransactionMessage({
                payerKey: payer,
                recentBlockhash: blockhash,
                instructions,
            }).compileToV0Message(altAccounts);

    const vtx = new VersionedTransaction(message);
    vtx.sign(jsonTx.signers);

    const balanceBefore = await connection.getBalance(payer);

    const sig = await connection.sendTransaction(vtx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed',
    );
    console.log('Transaction sent:', sig);

    const parsedTx = await connection.getParsedTransaction(sig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });
    parsedTx.meta?.logMessages?.forEach(log => {
        console.log(log);
    });

    const balanceAfter = await connection.getBalance(payer);
    const amountChanged = balanceAfter - balanceBefore;

    console.log('Total CUs used:', parsedTx.meta?.computeUnitsConsumed ?? 'n/a');
    console.log(`Balance changed: ${formatAmount(amountChanged)} lamports`);
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

async function createLookupTable(accountsPath, signer) {
    const connection = createConnection();
    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    const signerKeypair = parseKeypair(signer);
    const payerPubkey = signerKeypair.publicKey;
    const slot = (await connection.getSlot('finalized')) - 1;

    let [createIx, tableAddr] = AddressLookupTableProgram.createLookupTable({
        authority: payerPubkey,
        payer: payerPubkey,
        recentSlot: slot,
    });

    const extendIx = AddressLookupTableProgram.extendLookupTable({
        authority: payerPubkey,
        payer: payerPubkey,
        lookupTable: tableAddr,
        addresses: accounts.map(acc => new PublicKey(acc)),
    });

    await executeJsonTransaction({
        instructions: [createIx, extendIx],
        signers: [signerKeypair],
    });

    console.log(`Lookup table created at ${tableAddr.toBase58()} with ${accounts.length} accounts`);
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
    createLookupTable,
};
