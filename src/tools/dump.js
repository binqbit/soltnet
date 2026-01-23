const path = require('path');
const fs = require('fs');
const { PublicKey } = require("@solana/web3.js");

const { createConnection } = require("./tx.js");
const { loadTxFromJson } = require("../tx-format/json-tx.js");

const UPGRADEABLE_LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111";
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MAX_U64_STR = "18446744073709551615";
const MAX_U64 = BigInt(MAX_U64_STR);

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
            rentEpoch: normalizeU64String(accountInfo.rentEpoch),
            space: toBuffer(accountInfo.data).length,
        },
    };
}

function normalizeU64String(value) {
    if (typeof value === 'bigint') {
        if (value < 0n) return "0";
        return value > MAX_U64 ? MAX_U64_STR : value.toString();
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) return "0";
        if (value > Number.MAX_SAFE_INTEGER) {
            return MAX_U64_STR;
        }
        return Math.floor(value).toString();
    }
    if (typeof value === 'string') {
        if (!/^\d+$/.test(value)) return "0";
        try {
            const big = BigInt(value);
            if (big < 0n) return "0";
            return big > MAX_U64 ? MAX_U64_STR : value;
        } catch (_) {
            return "0";
        }
    }
    return "0";
}

function stringifyAccountPayload(payload) {
    const json = JSON.stringify(payload, null, '\t');
    return json.replace(/"rentEpoch":\s*"(\d+)"/g, '"rentEpoch": $1');
}

function normalizeAccountKey(account) {
    if (!account) return null;
    if (typeof account === 'string') return account;
    if (account.pubkey) {
        if (typeof account.pubkey === 'string') return account.pubkey;
        if (typeof account.pubkey.toBase58 === 'function') return account.pubkey.toBase58();
        if (typeof account.pubkey.toString === 'function') return account.pubkey.toString();
    }
    if (typeof account.toBase58 === 'function') return account.toBase58();
    if (typeof account.toString === 'function') return account.toString();
    return null;
}

function addAccountsFromList(targetSet, accounts) {
    if (!Array.isArray(accounts)) return;
    accounts.forEach((account) => {
        const key = normalizeAccountKey(account);
        if (key) {
            targetSet.add(key);
        }
    });
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
        fs.writeFileSync(outPath, stringifyAccountPayload(payload));
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
    const message = tx.transaction?.message;
    addAccountsFromList(accounts, message?.accountKeys);
    addAccountsFromList(accounts, message?.staticAccountKeys);
    addAccountsFromList(accounts, tx.meta?.loadedAddresses?.writable);
    addAccountsFromList(accounts, tx.meta?.loadedAddresses?.readonly);

    const tokenBalances = [
        ...(tx.meta?.preTokenBalances ?? []),
        ...(tx.meta?.postTokenBalances ?? []),
    ];
    const tokenMints = tokenBalances.map((balance) => balance?.mint).filter(Boolean);
    const tokenOwners = tokenBalances.map((balance) => balance?.owner).filter(Boolean);
    addAccountsFromList(accounts, tokenMints);
    addAccountsFromList(accounts, tokenOwners);

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

module.exports = {
    dumpAccount,
    dumpAccountsFromTx,
    dumpAccountsForTx,
    dumpRawTransaction,
    dumpRawBlock,
};
