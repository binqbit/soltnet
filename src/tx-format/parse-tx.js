const {
    parsePubkey,
} = require('./json-tx.js');
const { decode } = require('b58');

function findAtaAccounts(accounts) {
    console.log("Finding ATA accounts...");
    const ataAccounts = [];
    for (const owner of accounts) {
        for (const mint of accounts) {
            const ata = parsePubkey({
                type: 'ata',
                owner,
                mint,
            }).toString();
            if (accounts.includes(ata)) {
                console.log(`Found ATA: ${ata} for owner: ${owner} and mint: ${mint}`);
                ataAccounts.push({
                    type: 'ata',
                    owner,
                    mint,
                    pubkey: ata,
                });
            }
        }
    }
    return ataAccounts;
}

function parseTxToJson(rawTx) {
    const message = rawTx.transaction.message;
    const accountKeys = message.accountKeys;

    const signersAccounts = accountKeys
        .filter(k =>  k.signer)
        .map(k => k.pubkey.toString());
    const writableAccounts = accountKeys
        .filter(k => k.writable)
        .map(k => k.pubkey.toString());

    console.log(`Signers accounts: ${signersAccounts.join(', ')}`);

    const accounts = accountKeys.map(k => k.pubkey.toString());
    const ataAccounts = findAtaAccounts(accounts);

    function normalizeInstruction(ix) {
        const program_id = ix.programId.toString();
        const accounts = [];
        let data = ix.data || 0;
        console.log(`Parsing instruction for program ${program_id}...`);

        if ('accounts' in ix) {
            for (const account of ix.accounts) {
                accounts.push(account.toString());
            }
        } else if ('parsed' in ix) {
            for (const value of Object.values(ix.parsed.info)) {
                if (typeof value === "string") {
                    accounts.push(value.toString());
                } else if (typeof value === "number") {
                    data = {
                        type: "u64",
                        data: value,
                    };
                } else {
                    data = value;
                }
            }
        }

        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            let pubkey = account;
            for (const ata of ataAccounts) {
                if (ata.pubkey === account) {
                    pubkey = {
                        type: 'ata',
                        owner: ata.owner,
                        mint: ata.mint,
                    };
                    break;
                }
            }
            if (typeof pubkey === 'string') {
                const signerId = signersAccounts.indexOf(pubkey);
                if (signerId !== -1) {
                    pubkey = `\$${signerId + 1}`;
                }
            } else {
                const signerId = signersAccounts.indexOf(pubkey.owner);
                if (signerId !== -1) {
                    pubkey.owner = `\$${signerId + 1}`;
                }
            }
            accounts[i] = {
                pubkey,
                is_signer: signersAccounts.includes(account),
                is_writable: writableAccounts.includes(account)
            };
        }

        if (typeof data === 'string') {
            data = '0x' + decode(data).toString('hex');
        }

        return {
            program_id,
            data,
            accounts,
        };
    }

    return {
        instructions: message.instructions.map(normalizeInstruction),
        signers: signersAccounts.map((_, index) => `\$${signersAccounts.length + index + 1}`),
    };
}

module.exports = {
    parseTxToJson,
};
