const fs = require('fs');

const { unpackData, packData } = require("../tx-format/data-format.js");
const { loadTxFromJson } = require("../tx-format/json-tx.js");

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
    setDataFormat,
};
