const path = require('path');
const fs = require('fs');

const { createConnection } = require("./tx.js");
const { parseTxToJson, parseNativeProgram } = require("../tx-format/parse-tx.js");

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

        const instructions = tx.transaction.message.instructions.map((ix) => {
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

module.exports = {
    createJsonFromTx,
    parseBlock,
};
