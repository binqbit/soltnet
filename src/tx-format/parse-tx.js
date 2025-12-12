const { SYSTEM_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('../accounts.js');
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

function parseNativeProgram(programId, parsed) {
    if (!parsed) {
        return { accounts: [], data: undefined };
    }

    switch (programId) {
        case SYSTEM_PROGRAM_ID.toString(): {
            switch (parsed.type) {
                case 'transfer': {
                    return {
                        data: {
                            type: 'object',
                            data: [
                                {
                                    type: 'u32',
                                    data: 2,
                                },
                                {
                                    type: 'u64',
                                    data: parsed.info.lamports,
                                }
                            ]
                        },
                        accounts: [
                            parsed.info.source.toString(),
                            parsed.info.destination.toString()
                        ]
                    };
                }
                default: {
                    return {
                        accounts: Object.values(parsed.info)
                            .filter(value => typeof value === 'string')
                    };
                }
            }
        }
        case ASSOCIATED_TOKEN_PROGRAM_ID.toString(): {
            return {
                accounts: [
                    parsed.info.wallet.toString(),
                    parsed.info.account.toString(),
                    parsed.info.source.toString(),
                    parsed.info.mint.toString(),
                    parsed.info.systemProgram.toString(),
                    parsed.info.tokenProgram.toString()
                ]
            };
        }
        default: {
            const info = parsed.info;
            const accounts =
                info && typeof info === 'object' && !Array.isArray(info)
                    ? Object.values(info).filter(value => typeof value === 'string')
                    : [];
            const data =
                typeof info === 'string' || typeof info === 'number' ? info : undefined;

            return {
                accounts,
                data,
            };
        }
    }
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
            const { accounts: parsedAccounts = [], data: parsedData } = parseNativeProgram(program_id, ix.parsed);
            accounts.push(...parsedAccounts);
            if (parsedData) {
                data = parsedData;
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
