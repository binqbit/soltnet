#!/usr/bin/env node

const { parseArgs } = require("node:util");
const path = require("node:path");

const { stopTestnetContainer, startTestnetContainer, setTestnetConfig } = require("./config.js");
const { loadTxFromJson } = require("./tx-format/json-tx.js");
const {
    executeJsonTransaction,
    getBalance,
    airdropSol,
    createAta,
    closeAta,
    getTokenBalance,
    sendSol,
    createLookupTable,
} = require("./tools/tx.js");
const {
    dumpAccount,
    dumpAccountsFromTx,
    dumpAccountsForTx,
    dumpRawTransaction,
    dumpRawBlock,
    createJsonFromTx,
    parseBlock,
    setDataFormat,
} = require("./tools/data.js");

class CLIError extends Error {
    constructor(message) {
        super(message);
        this.name = "CLIError";
    }
}

const binaryName = path.basename("soltnet");

const commands = new Map([
    ["load", {
        summary: "Copy accounts/programs into the local testnet config",
        usage: `${binaryName} load <accounts-path>`,
        run: ([accountsPath]) => {
            if (!accountsPath) {
                throw new CLIError("Missing <accounts-path> for command \"load\".");
            }
            setTestnetConfig(accountsPath);
        },
    }],
    ["clear", {
        summary: "Clear the local testnet configuration",
        usage: `${binaryName} clear`,
        run: () => {
            setTestnetConfig();
        },
    }],
    ["start", {
        summary: "Start the local testnet container",
        usage: `${binaryName} start`,
        run: () => new Promise((resolve) => {
            startTestnetContainer(resolve);
        }),
    }],
    ["stop", {
        summary: "Stop the local testnet container",
        usage: `${binaryName} stop`,
        run: () => new Promise((resolve) => {
            stopTestnetContainer(resolve);
        }),
    }],
    ["exec-tx", {
        summary: "Execute a transaction described in JSON",
        usage: `${binaryName} exec-tx <tx-json> [<param> ...]`,
        run: ([txPath, ...params]) => {
            if (!txPath) {
                throw new CLIError("Missing <tx-json> for command \"exec-tx\".");
            }
            const txJson = loadTxFromJson(txPath, params);
            return executeJsonTransaction(txJson);
        },
    }],
    ["balance", {
        summary: "Retrieve SOL balance for an account",
        usage: `${binaryName} balance <pubkey>`,
        run: ([address]) => {
            if (!address) {
                throw new CLIError("Missing <pubkey> for command \"balance\".");
            }
            return getBalance(address);
        },
    }],
    ["airdrop", {
        summary: "Request an airdrop of SOL",
        usage: `${binaryName} airdrop <pubkey> [<amount-sol>]`,
        run: ([address, amount]) => {
            if (!address) {
                throw new CLIError("Missing <pubkey> for command \"airdrop\".");
            }
            const amountSol = (amount ?? "1").replace(/_/g, "");
            return airdropSol(address, parseInt(amountSol, 10) * 1_000_000_000);
        },
    }],
    ["send-sol", {
        summary: "Transfer SOL between two accounts",
        usage: `${binaryName} send-sol <from> <to> <amount-lamports> <signer-keypair>`,
        run: ([from, to, amount, signer]) => {
            if (!from || !to || !amount || !signer) {
                throw new CLIError("Usage: send-sol <from> <to> <amount-lamports> <signer-keypair>");
            }
            const lamports = parseInt(amount.replace(/_/g, ""), 10);
            return sendSol(from, to, lamports, signer);
        },
    }],
    ["create-ata", {
        summary: "Create an associated token account",
        usage: `${binaryName} create-ata <owner> <mint> <signer-keypair>`,
        run: ([owner, mint, signer]) => {
            if (!owner || !mint || !signer) {
                throw new CLIError("Usage: create-ata <owner> <mint> <signer-keypair>");
            }
            return createAta(owner, mint, signer);
        },
    }],
    ["close-ata", {
        summary: "Close an associated token account",
        usage: `${binaryName} close-ata <owner> <mint> <signer-keypair>`,
        run: ([owner, mint, signer]) => {
            if (!owner || !mint || !signer) {
                throw new CLIError("Usage: close-ata <owner> <mint> <signer-keypair>");
            }
            return closeAta(owner, mint, signer);
        },
    }],
    ["token-balance", {
        summary: "Retrieve SPL token balance for an account",
        usage: `${binaryName} token-balance <owner> <mint>`,
        run: ([owner, mint]) => {
            if (!owner || !mint) {
                throw new CLIError("Usage: token-balance <owner> <mint>");
            }
            return getTokenBalance(owner, mint);
        },
    }],
    ["create-lookup-table", {
        summary: "Create an address lookup table using accounts JSON",
        usage: `${binaryName} create-lookup-table <accounts-json> <signer-keypair>`,
        run: ([accountsPath, signer]) => {
            if (!accountsPath || !signer) {
                throw new CLIError("Usage: create-lookup-table <accounts-json> <signer-keypair>");
            }
            return createLookupTable(accountsPath, signer);
        },
    }],
    ["dump", {
        summary: "Dump account or program data from mainnet",
        usage: `${binaryName} dump <pubkey> [<output-path>]`,
        run: ([address, outputPath]) => {
            if (!address) {
                throw new CLIError("Missing <pubkey> for command \"dump\".");
            }
            return dumpAccount(address, outputPath ?? ".");
        },
    }],
    ["dump-from-tx", {
        summary: "Dump all accounts touched by a transaction",
        usage: `${binaryName} dump-from-tx <signature> [<output-path>]`,
        run: ([signature, outputPath]) => {
            if (!signature) {
                throw new CLIError("Missing <signature> for command \"dump-from-tx\".");
            }
            return dumpAccountsFromTx(signature, outputPath ?? ".");
        },
    }],
    ["dump-for-tx", {
        summary: "Dump all accounts required by a transaction template",
        usage: `${binaryName} dump-for-tx <tx-json> [<output-path>] [<param> ...]`,
        run: ([txPath, outputPath, ...params]) => {
            if (!txPath) {
                throw new CLIError("Missing <tx-json> for command \"dump-for-tx\".");
            }
            return dumpAccountsForTx(txPath, outputPath ?? ".", params);
        },
    }],
    ["parse-tx", {
        summary: "Fetch a transaction and store its JSON representation",
        usage: `${binaryName} parse-tx <signature> [<output-path>]`,
        run: ([signature, outputPath]) => {
            if (!signature) {
                throw new CLIError("Missing <signature> for command \"parse-tx\".");
            }
            return createJsonFromTx(signature, outputPath ?? ".");
        },
    }],
    ["parse-block", {
        summary: "Parse/analyze a block by slot (accounts, balances, instructions)",
        usage: `${binaryName} parse-block <slot> [<output-path>]`,
        run: ([slot, outputPath]) => {
            if (!slot) {
                throw new CLIError("Missing <slot> for command \"parse-block\".");
            }
            return parseBlock(slot, outputPath ?? ".");
        },
    }],
    ["dump-tx", {
        summary: "Fetch a raw transaction response and store it as JSON",
        usage: `${binaryName} dump-tx <signature> [<output-path>]`,
        run: ([signature, outputPath]) => {
            if (!signature) {
                throw new CLIError("Missing <signature> for command \"dump-tx\".");
            }
            return dumpRawTransaction(signature, outputPath ?? ".");
        },
    }],
    ["dump-block", {
        summary: "Fetch a raw block response and store it as JSON",
        usage: `${binaryName} dump-block <slot> [<output-path>]`,
        run: ([slot, outputPath]) => {
            if (!slot) {
                throw new CLIError("Missing <slot> for command \"dump-block\".");
            }
            return dumpRawBlock(slot, outputPath ?? ".");
        },
    }],
    ["set-data-format", {
        summary: "Apply a data format to an instruction inside a transaction JSON",
        usage: `${binaryName} set-data-format <tx-json> <format-json> <program-id>`,
        run: ([txPath, formatPath, programId]) => {
            if (!txPath || !formatPath || !programId) {
                throw new CLIError("Usage: set-data-format <tx-json> <format-json> <program-id>");
            }
            return setDataFormat(txPath, formatPath, programId);
        },
    }],
]);

function printHelp(targetCommand) {
    if (targetCommand) {
        const entry = commands.get(targetCommand);
        if (!entry) {
            console.error(`Unknown command: ${targetCommand}`);
            process.exit(1);
        }
        console.log(`Usage: ${entry.usage}`);
        console.log(entry.summary);
        return;
    }

    console.log(`Usage: ${binaryName} <command> [<args>]\n`);
    console.log("Commands:");

    const longestUsage = Math.max(
        ...Array.from(commands.values(), entry => entry.usage.length),
        0,
    );

    for (const [name, entry] of commands) {
        const paddedUsage = entry.usage.padEnd(longestUsage, " ");
        console.log(`  ${paddedUsage}  ${entry.summary}`);
    }

    console.log(`\nRun \`${binaryName} help <command>\` for detailed usage.`);
}

const { values, positionals } = parseArgs({
    options: {
        help: {
            type: "boolean",
            short: "h",
        },
    },
    allowPositionals: true,
});

if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(values.help ? 0 : 1);
}

const [commandName, ...commandArgs] = positionals;

if (commandName === "help") {
    const [target] = commandArgs;
    printHelp(target);
    process.exit(0);
}

const entry = commands.get(commandName);

if (!entry) {
    console.error(`Unknown command: ${commandName}`);
    printHelp();
    process.exit(1);
}

Promise.resolve()
    .then(() => entry.run(commandArgs))
    .catch((error) => {
        if (error instanceof CLIError) {
            console.error(error.message);
        } else {
            console.error(error);
        }
        process.exit(1);
    });
