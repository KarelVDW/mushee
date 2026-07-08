import { Logger } from '@nestjs/common';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { dirname, sep } from 'path';

const logger = new Logger('TfBackend');
let backendReady: Promise<void> | null = null;

/**
 * Initialize the WASM backend for TF.js exactly once per process. Safe to
 * call from multiple providers — subsequent calls return the same promise.
 */
export function ensureWasmBackend(): Promise<void> {
  if (!backendReady) {
    backendReady = (async () => {
      const wasmDir =
        dirname(require.resolve('@tensorflow/tfjs-backend-wasm')) + sep;
      setWasmPaths(wasmDir);
      await tf.setBackend('wasm');
      await tf.ready();
      logger.log(`TF backend active: ${tf.getBackend()}`);
    })();
  }
  return backendReady;
}
