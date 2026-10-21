import { Logger } from '@nestjs/common'
import * as tf from '@tensorflow/tfjs'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import { readFile } from 'fs/promises'
import { dirname, join, sep } from 'path'

const logger = new Logger('TfBackend')
let backendReady: Promise<void> | null = null

/**
 * Initialize the WASM backend for TF.js exactly once per process. Safe to
 * call from multiple providers — subsequent calls return the same promise.
 */
export function ensureWasmBackend(): Promise<void> {
    if (!backendReady) {
        backendReady = (async () => {
            const wasmDir = dirname(require.resolve('@tensorflow/tfjs-backend-wasm')) + sep
            setWasmPaths(wasmDir)
            await tf.setBackend('wasm')
            await tf.ready()
            logger.log(`TF backend active: ${tf.getBackend()}`)
        })()
    }
    return backendReady
}

/**
 * Read a TF.js model directory — `model.json` plus the weight shards its
 * `weightsManifest` lists — into in-memory artifacts for `io.fromMemory`: every
 * shard in manifest order, concatenated into one buffer. Both bundled models
 * (CREPE's layers model, YAMNet's graph model) load through this; they differ
 * only in the loader they hand it to.
 */
export async function readModelArtifacts(dir: string): Promise<tf.io.ModelArtifacts> {
    const modelJson = JSON.parse(await readFile(join(dir, 'model.json'), 'utf8')) as tf.io.ModelJSON
    const weightSpecs = modelJson.weightsManifest.flatMap((entry) => entry.weights)
    const shards = await Promise.all(modelJson.weightsManifest.flatMap((entry) => entry.paths).map((path) => readFile(join(dir, path))))
    const weightData = new Uint8Array(shards.reduce((total, shard) => total + shard.byteLength, 0))
    let offset = 0
    for (const shard of shards) {
        weightData.set(shard, offset)
        offset += shard.byteLength
    }
    return { modelTopology: modelJson.modelTopology, weightSpecs, weightData: weightData.buffer }
}
