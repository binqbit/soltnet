const { stopTestnetContainer, startTestnetContainer, setTestnetConfig } = require("./config.js");
const { loadTxFromJson } = require("./json-tx.js");
const { executeJsonTransaction, getBalance, airdropSol, createAta, closeAta, getTokenBalance, dumpAccount } = require("./tx.js");

const CMD = process.argv[2];

switch (CMD) {
    case "load":
        setTestnetConfig(process.argv[3]);
        break;
    case "start":
        startTestnetContainer(() => {
            process.exit(0);
        });
        break;
    case "stop":
        stopTestnetContainer(() => {
            process.exit(0);
        });
        break;
    case "exec-tx":
        const txJson = loadTxFromJson(process.argv[3], process.argv.slice(4));
        executeJsonTransaction(txJson);
        break;
    case "dump":
        dumpAccount(process.argv[3], process.argv[4] ?? '.');
        break;
    case "balance":
        getBalance(process.argv[3]);
        break;
    case "airdrop":
        airdropSol(process.argv[3], parseInt((process.argv[4] ?? '1_000_000_000').replace(/_/g, '')));
        break;
    case "create-ata":
        createAta(process.argv[3], process.argv[4], process.argv[5]);
        break;
    case "close-ata":
        closeAta(process.argv[3], process.argv[4], process.argv[5]);
        break;
    case "token-balance":
        getTokenBalance(process.argv[3], process.argv[4]);
        break;
    default:
        console.error(`Unknown command: ${CMD}`);
        process.exit(1);
}
