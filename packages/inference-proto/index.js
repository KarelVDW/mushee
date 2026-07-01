const { join } = require('path');

/** Absolute path to the inference .proto, for @grpc/proto-loader consumers. */
module.exports.PROTO_PATH = join(__dirname, 'inference.proto');
module.exports.PROTO_PACKAGE = 'mushee.inference.v1';
