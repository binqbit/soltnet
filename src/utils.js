
function removeUnderscores(num) {
    return num.toString().replace(/_/g, '');
}

function addUnderscores(str) {
    const partLength = 3;
    const parts = [];
    for (let i = str.length; i > 0; i -= partLength) {
        parts.unshift(str.slice(Math.max(0, i - partLength), i));
    }
    return parts.join('_');
}

function formatAmount(num) {
    const prefix = num < 0 ? '-' : '';
    num = Math.abs(num).toString();
    num = removeUnderscores(num);
    if (num.includes('.')) {
        const [integerPart, fractionalPart] = num.split('.');
        return prefix + addUnderscores(integerPart) + '.' + addUnderscores(fractionalPart);
    } else {
        return prefix + addUnderscores(num);
    }
}

module.exports = {
    formatAmount
};
