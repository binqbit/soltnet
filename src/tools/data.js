const path = require('path');
const fs = require('fs');
const { PublicKey } = require("@solana/web3.js");

const { createConnection } = require("./tx.js");
const { unpackData, packData } = require("../tx-format/data-format.js");
const { loadTxFromJson } = require("../tx-format/json-tx.js");
const { parseTxToJson, parseNativeProgram } = require("../tx-format/parse-tx.js");

const UPGRADEABLE_LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111";
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

function toBuffer(data) {
    if (!data) return Buffer.alloc(0);
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function extractElfBytes(data) {
    const buf = toBuffer(data);
    if (buf.length === 0) return null;
    const offset = buf.indexOf(ELF_MAGIC);
    if (offset < 0) return null;
    return buf.slice(offset);
}

function tryGetUpgradeableProgramDataAddress(data) {
    const buf = toBuffer(data);
    if (buf.length < 4 + 32) return null;
    const tag = buf.readUInt32LE(0);
    if (tag !== 2) return null;
    try {
        return new PublicKey(buf.slice(4, 36));
    } catch (_) {
        return null;
    }
}

function serializeAccountInfo(pubkey, accountInfo) {
    return {
        pubkey: pubkey.toBase58(),
        account: {
            lamports: accountInfo.lamports,
            data: [toBuffer(accountInfo.data).toString('base64'), 'base64'],
            owner: accountInfo.owner.toBase58(),
            executable: accountInfo.executable,
            rentEpoch: accountInfo.rentEpoch,
            space: toBuffer(accountInfo.data).length,
        },
    };
}

async function dumpAccount(address, toPath) {
    if (!fs.existsSync(toPath)) {
        fs.mkdirSync(toPath, { recursive: true });
    }

    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const pubkey = new PublicKey(address);
    const accountInfo = await connection.getAccountInfo(pubkey);
    if (!accountInfo) {
        throw new Error(`Account not found: ${address}`);
    }
    if (accountInfo.executable) {
        console.log(`Dumping program ${address}...`);
        let programData = accountInfo.data;
        if (accountInfo.owner?.toBase58() === UPGRADEABLE_LOADER_ID) {
            const programDataAddress = tryGetUpgradeableProgramDataAddress(accountInfo.data);
            if (programDataAddress) {
                const programDataInfo = await connection.getAccountInfo(programDataAddress);
                if (programDataInfo?.data) {
                    programData = programDataInfo.data;
                }
            }
        }

        const elfBytes = extractElfBytes(programData);
        if (!elfBytes || elfBytes.length === 0) {
            throw new Error(`Program data not found or not ELF for: ${address}`);
        }

        const outPath = path.join(toPath, `${address}.so`);
        fs.writeFileSync(outPath, elfBytes);
        console.log(`Program dumped to ${outPath}`);
    } else {
        console.log(`Dumping account ${address}...`);
        const outPath = path.join(toPath, `${address}.json`);
        const payload = serializeAccountInfo(pubkey, accountInfo);
        fs.writeFileSync(outPath, JSON.stringify(payload, null, '\t'));
        console.log(`Account dumped to ${outPath}`);
    }
}

async function dumpAccountsFromTx(signature, toPath) {
    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) {
        throw new Error(`Transaction not found: ${signature}`);
    }

    const accounts = new Set();
    (tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys).forEach(account => {
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

async function dumpRawTransaction(signature, toPath = '.') {
    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const tx = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) {
        throw new Error(`Transaction not found: ${signature}`);
    }

    if (!fs.existsSync(toPath)) {
        fs.mkdirSync(toPath, { recursive: true });
    }

    const filePath = path.join(toPath, `${signature}.json`);
    fs.writeFileSync(filePath, JSON.stringify(tx, null, '\t'));
    console.log(`Raw transaction dumped to ${filePath}`);
}

async function dumpRawBlock(slot, toPath = '.') {
    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const blockNumber = Number(slot);
    if (Number.isNaN(blockNumber)) {
        throw new Error(`Invalid slot: ${slot}`);
    }

    const block = await connection.getParsedBlock(blockNumber, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!block) {
        throw new Error(`Block not found: ${slot}`);
    }

    if (!fs.existsSync(toPath)) {
        fs.mkdirSync(toPath, { recursive: true });
    }

    const filePath = path.join(toPath, `${blockNumber}.json`);
    fs.writeFileSync(filePath, JSON.stringify(block, null, '\t'));
    console.log(`Raw block dumped to ${filePath}`);
}

async function createJsonFromTx(signature, toPath) {
    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const tx = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) {
        throw new Error(`Transaction not found: ${signature}`);
    }

    console.log(`Parsing transaction ${signature}...`);
    const json = JSON.stringify(parseTxToJson(tx), null, '\t');
    fs.writeFileSync(path.join(toPath, `${signature}.json`), json);
    console.log(`Transaction dumped to ${path.join(toPath, `${signature}.json`)}`);
}

async function parseBlock(slot, toPath = '.') {
    const connection = createConnection('http://api.mainnet-beta.solana.com');
    const blockNumber = Number(slot);
    if (Number.isNaN(blockNumber)) {
        throw new Error(`Invalid slot: ${slot}`);
    }

    const block = await connection.getParsedBlock(blockNumber, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });
    if (!block) {
        throw new Error(`Block not found: ${slot}`);
    }

    const parsedTxs = block.transactions.map((tx) => {
        const accountKeys = tx.transaction.message.accountKeys;
        const meta = tx.meta ?? {};

        const accountMetaByIndex = accountKeys.map((k, idx) => ({
            pubkey: k.pubkey.toString(),
            isSigner: k.signer,
            isWritable: k.writable,
            preBalance: meta.preBalances?.[idx] ?? null,
            postBalance: meta.postBalances?.[idx] ?? null,
        }));

        const normalizeIxAccounts = (ixAccounts = []) => ixAccounts.map((acc) => {
            const pubkey = typeof acc === 'number'
                ? accountKeys[acc]?.pubkey.toString()
                : acc?.toString();
            const metaEntry = pubkey ? accountMetaByIndex.find(a => a.pubkey === pubkey) : undefined;
            return {
                pubkey: pubkey ?? null,
                isSigner: metaEntry?.isSigner ?? false,
                isWritable: metaEntry?.isWritable ?? false,
            };
        });

        const findAccountName = (pubkey, parsedInfo) => {
            if (!parsedInfo || typeof parsedInfo !== 'object') return null;
            for (const [key, value] of Object.entries(parsedInfo)) {
                if (typeof value === 'string' && value === pubkey) return key;
                if (Array.isArray(value) && value.includes(pubkey)) return key;
                if (value && typeof value === 'object') {
                    if (typeof value.pubkey === 'string' && value.pubkey === pubkey) return key;
                    if (typeof value.wallet === 'string' && value.wallet === pubkey) return key;
                    if (typeof value.owner === 'string' && value.owner === pubkey) return key;
                }
            }
            return null;
        };

        const instructions = tx.transaction.message.instructions.map((ix, ixIndex) => {
            const accounts = normalizeIxAccounts(ix.accounts).map((acc) => {
                const name = findAccountName(acc.pubkey, ix.parsed?.info);
                const entry = { ...acc };
                if (name != null) {
                    entry.name = name;
                }
                return entry;
            });

            const programId = ix.programId.toString();
            const nativeParsed = ix.parsed ? parseNativeProgram(programId, ix.parsed) : null;
            let data = nativeParsed?.data
                ?? (ix.parsed?.info ?? ix.parsed ?? ix.data ?? null);

            if (typeof data === "string") {
                let buf = null;
                try {
                    buf = Buffer.from(data, "base64");
                } catch (_) { /* ignore */ }
                if (!buf || buf.length === 0) {
                    try {
                        buf = Buffer.from(require("bs58").decode(data));
                    } catch (_) { /* ignore */ }
                }
                if (buf && buf.length > 0) {
                    data = `0x${buf.toString("hex")}`;
                }
            }

            return {
                program: ix.programId.toString(),
                data,
                accounts,
            };
        });

        return {
            signature: tx.transaction.signatures[0]?.toString() ?? null,
            ixs: instructions,
            meta: {
                logs: meta.logMessages ?? [],
                accounts: accountMetaByIndex.map(({ pubkey, preBalance, postBalance }) => ({
                    pubkey,
                    preBalance,
                    postBalance,
                    balanceChange: (postBalance != null && preBalance != null)
                        ? postBalance - preBalance
                        : 0,
                })),
            },
        };
    });

    if (!fs.existsSync(toPath)) {
        fs.mkdirSync(toPath, { recursive: true });
    }

    const filePath = path.join(toPath, `${blockNumber}.json`);
    const payload = {
        slot: blockNumber.toString(),
        txs: parsedTxs,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, '\t'));
    console.log(`Parsed block saved to ${filePath}`);
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
    dumpRawTransaction,
    dumpRawBlock,
    createJsonFromTx,
    parseBlock,
    setDataFormat,
};
