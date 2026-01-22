const dump = require("./dump.js");
const parse = require("./parse.js");
const dataFormat = require("./data-format.js");

module.exports = {
    ...dump,
    ...parse,
    ...dataFormat,
};
