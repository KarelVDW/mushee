import * as grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { PROTO_PATH } from '@mushee/inference-proto';
import { Logger } from '@nestjs/common';

import type {
  BasicPitchForwardResult,
  ModelBackend,
  ModelKey,
} from './model-backend';

/** Per-call deadline; the forward pass is bounded so this is generous. */
const CALL_TIMEOUT_MS = Number(process.env.INFERENCE_TIMEOUT_MS) || 15000;

const PKG = 'mushee.inference.v1';

interface GrpcClient extends grpc.Client {
  [method: string]: unknown;
}

function loadProto(): grpc.GrpcObject {
  const def = loadSync(PROTO_PATH, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(def);
}

/** Float32Array → wire Buffer (zero-copy view over its bytes). */
function f32ToBytes(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** Wire bytes → Float32Array of `count` elements (copying; the buffer may be
 *  unaligned for a typed-array view). */
function bytesToF32(bytes: Buffer, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes.readFloatLE(i * 4);
  return out;
}

/**
 * Runs a single model's forward pass in a remote inference service over gRPC.
 * One instance serves exactly one model (its own service + channel); the
 * pipeline composes per-model backends (see `createModelBackend`). The proto
 * contract is in `@mushee/inference-proto`.
 */
export class RemoteModelBackend implements ModelBackend {
  private readonly logger = new Logger(RemoteModelBackend.name);
  private readonly client: GrpcClient;

  constructor(
    private readonly model: ModelKey,
    private readonly url: string,
  ) {
    // proto-loader nests by package segment: proto.mushee.inference.v1.*
    const pkg = PKG.split('.').reduce<Record<string, unknown>>(
      (obj, key) => obj[key] as Record<string, unknown>,
      loadProto() as unknown as Record<string, unknown>,
    );
    const ServiceCtor = pkg[
      model === 'crepe-tiny' ? 'CrepeInference' : 'BasicPitchInference'
    ] as new (
      address: string,
      creds: grpc.ChannelCredentials,
      options?: object,
    ) => GrpcClient;
    this.client = new ServiceCtor(url, grpc.credentials.createInsecure(), {
      'grpc.keepalive_time_ms': 20000,
      'grpc.max_receive_message_length': 64 * 1024 * 1024,
      'grpc.max_send_message_length': 64 * 1024 * 1024,
    });
  }

  available(model: ModelKey): boolean {
    return model === this.model;
  }

  async warm(model: ModelKey): Promise<void> {
    if (model !== this.model) return;
    // Best-effort readiness ping; the service warms its model on startup.
    try {
      await this.unary('Health', {});
    } catch (err) {
      this.logger.warn(
        `Inference service for ${model} at ${this.url} not ready: ${describe(err)}`,
      );
    }
  }

  async crepePredict(
    frames: Float32Array,
    batchCount: number,
  ): Promise<Float32Array> {
    const frameSize = frames.length / batchCount;
    const res = await this.unary<{
      activations: Buffer;
      batchCount: number;
      numBins: number;
    }>('Predict', {
      frames: f32ToBytes(frames),
      batchCount,
      frameSize,
    });
    return bytesToF32(res.activations, res.batchCount * res.numBins);
  }

  async basicPitchForward(
    samples: Float32Array,
  ): Promise<BasicPitchForwardResult> {
    const res = await this.unary<{
      frames: Buffer;
      onsets: Buffer;
      numFrames: number;
      numPitches: number;
    }>('Forward', { samples: f32ToBytes(samples) });
    return {
      frames: unflatten(res.frames, res.numFrames, res.numPitches),
      onsets: unflatten(res.onsets, res.numFrames, res.numPitches),
    };
  }

  private unary<R>(method: string, req: object): Promise<R> {
    const fn = this.client[method] as (
      req: object,
      opts: grpc.CallOptions,
      cb: (err: grpc.ServiceError | null, res: R) => void,
    ) => void;
    const deadline = new Date(Date.now() + CALL_TIMEOUT_MS);
    return new Promise<R>((resolve, reject) => {
      fn.call(this.client, req, { deadline }, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
  }
}

function unflatten(bytes: Buffer, rows: number, cols: number): number[][] {
  const out: number[][] = new Array<number[]>(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array<number>(cols);
    const base = r * cols * 4;
    for (let c = 0; c < cols; c++) row[c] = bytes.readFloatLE(base + c * 4);
    out[r] = row;
  }
  return out;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
