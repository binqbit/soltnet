const {
    PublicKey,
} = require('@solana/web3.js');
const { parsePubkey } = require('./pubkey.js');

function getParamOrDefault(value, params) {
    for (let param_id = 0; param_id < params.length; param_id++) {
        if (value === `\$${param_id + 1}`) {
            return params[param_id];
        }
    }
    return value;
}

function packData(data, params = []) {
    switch (typeof data) {
        case 'boolean':
            data = getParamOrDefault(data, params);
            if (typeof data !== 'boolean') {
                data = data === 'true';
            }
            return Buffer.from([data ? 1 : 0]);
        case 'number':
            data = getParamOrDefault(data, params);
            if (typeof data !== 'number') {
                data = parseInt(data);
            }
            return Buffer.from(new Uint8Array(new Array(data).fill(0)));
        case 'string':
            data = getParamOrDefault(data, params);
            if (data.startsWith('0x')) {
                return Buffer.from(data.slice(2), 'hex');
            } else {
                return Buffer.from(data, 'base64');
            }
        case 'array':
        case 'object':
            data = getParamOrDefault(data, params);
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }
            if (Array.isArray(data)) {
                for (let i = 0; i < data.length; i++) {
                    value = getParamOrDefault(data[i], params);
                    if (typeof value === 'string') {
                        value = parseInt(value);
                    }
                    data[i] = value;
                }
                return Buffer.from(new Uint8Array(data));
            } else {
                let buffer = Buffer.alloc(0);
                switch (data.type) {
                    case 'u8':
                        data.data = getParamOrDefault(data.data, params);
                        if (typeof data.data === 'string') {
                            data.data = parseInt(data.data);
                        }
                        const u8Buffer = Buffer.alloc(1);
                        u8Buffer.writeUInt8(data.data, 0);
                        buffer = Buffer.concat([buffer, u8Buffer]);
                        break;
                    case 'u16':
                        data.data = getParamOrDefault(data.data, params);
                        if (typeof data.data === 'string') {
                            data.data = parseInt(data.data);
                        }
                        const u16Buffer = Buffer.alloc(2);
                        u16Buffer.writeUInt16LE(data.data, 0);
                        buffer = Buffer.concat([buffer, u16Buffer]);
                        break;
                    case 'u32':
                        data.data = getParamOrDefault(data.data, params);
                        if (typeof data.data === 'string') {
                            data.data = parseInt(data.data);
                        }
                        const u32Buffer = Buffer.alloc(4);
                        u32Buffer.writeUInt32LE(data.data, 0);
                        buffer = Buffer.concat([buffer, u32Buffer]);
                        break;
                    case 'u64':
                        data.data = getParamOrDefault(data.data, params);
                        const u64Buffer = Buffer.alloc(8);
                        u64Buffer.writeBigUInt64LE(BigInt(data.data), 0);
                        buffer = Buffer.concat([buffer, u64Buffer]);
                        break;
                    case 'pubkey':
                        buffer = Buffer.concat([buffer, parsePubkey(data.data, params).toBuffer()]);
                        break;
                    case 'string':
                        buffer = Buffer.concat([buffer, packData(data.data, params)]);
                        break;
                    case 'bytes':
                        buffer = Buffer.concat([buffer, packData(data.data, params)]);
                        break;
                    case 'object':
                        for (const item of data.data) {
                            buffer = Buffer.concat([buffer, packData(item, params)]);
                        }
                        break;
                }
                return buffer;
            }
        default:
            throw new Error(`Unsupported data type: ${typeof data}`);
    }
}

function unpackData(buffer, schema, offset = 0) {
    if (Array.isArray(schema)) {
        return schema.map(entry => {
            const res = unpackData(buffer, entry, offset);
            offset += getByteLength(res);
            return res;
        });
    }

    if (typeof schema !== 'object') {
        throw new Error('Schema must be object or array');
    }

    switch (schema.type) {
        case 'u8': {
            const data = buffer.readUInt8(offset);
            return { ...schema, data };
        }
        case 'u16': {
            const data = buffer.readUInt16LE(offset);
            return { ...schema, data };
        }
        case 'u32': {
            const data = buffer.readUInt32LE(offset);
            return { ...schema, data };
        }
        case 'u64': {
            let data = buffer.readBigUInt64LE(offset);
            if (data > Number.MAX_SAFE_INTEGER) {
                data = data.toString();
            } else {
                data = Number(data);
            }
            return { ...schema, data };
        }
        case 'boolean': {
            const data = !!buffer[offset];
            return { ...schema, data };
        }
        case 'pubkey': {
            const data = new PublicKey(buffer.slice(offset, offset + 32)).toBase58();
            return { ...schema, data };
        }
        case 'bytes': {
            const size = schema.Size;
            if (typeof size !== 'number') throw new Error('Missing Size in bytes schema');
            const data = buffer.slice(offset, offset + size).toString('base64');
            return { ...schema, size, data };
        }
        case 'string': {
            const len = schema.length;
            if (typeof len !== 'number') throw new Error('Missing Length in string schema');
            const data = buffer.slice(offset, offset + len).toString('utf8');
            return { ...schema, length: len, data };
        }
        case 'object': {
            const out = [];
            for (const entry of schema.data) {
                const res = unpackData(buffer, entry, offset);
                out.push(res);
                offset += getByteLength(res);
            }
            return { type: 'object', name: schema.name, data: out };
        }
        default:
            throw new Error(`Unknown type: ${schema.type}`);
    }
}

function getByteLength(entry) {
    switch (entry.type) {
        case 'u8': return 1;
        case 'u16': return 2;
        case 'u32': return 4;
        case 'u64': return 8;
        case 'boolean': return 1;
        case 'pubkey': return 32;
        case 'bytes': return entry.size;
        case 'string': return entry.length;
        case 'object':
            return entry.data.reduce((acc, x) => acc + getByteLength(x), 0);
        default:
            throw new Error(`Unknown type for byte length: ${entry.type}`);
    }
}

module.exports = {
    packData,
    unpackData,
};
