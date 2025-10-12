const { stopTestnetContainer, startTestnetContainer, setTestnetConfig } = require("./config.js");
const { loadTxFromJson } = require("./tx-format/json-tx.js");
const { executeJsonTransaction, getBalance, airdropSol, createAta, closeAta, getTokenBalance, sendSol, createLookupTable } = require("./tools/tx.js");
const { dumpAccount, dumpAccountsFromTx, dumpAccountsForTx, createJsonFromTx, setDataFormat } = require("./tools/data.js");

const CMD = process.argv[2];

switch (CMD) {
    case "load":
        setTestnetConfig(process.argv[3]);
        break;
    case "clear":
        setTestnetConfig();
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
    case "balance":
        getBalance(process.argv[3]);
        break;
    case "airdrop":
        airdropSol(process.argv[3], parseInt((process.argv[4] ?? '1').replace(/_/g, '')) * 1_000_000_000);
        break;
    case "send-sol":
        sendSol(process.argv[3], process.argv[4], parseInt(process.argv[5].replace(/_/g, '')), process.argv[6]);
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
    case "create-lookup-table":
        createLookupTable(process.argv[3], process.argv[4]);
        break;
        
    case "dump":
        dumpAccount(process.argv[3], process.argv[4] ?? '.');
        break;
    case "dump-from-tx":
        dumpAccountsFromTx(process.argv[3], process.argv[4] ?? '.');
        break;
    case "dump-for-tx":
        dumpAccountsForTx(process.argv[3], process.argv[4], process.argv.slice(5));
        break;
    case "parse-tx":
        createJsonFromTx(process.argv[3], process.argv[4] ?? '.');
        break;
    case "set-data-format":
        setDataFormat(process.argv[3], process.argv[4], process.argv[5]);
        break;
        
    default:
        console.error(`Unknown command: ${CMD}`);
        process.exit(1);
}
