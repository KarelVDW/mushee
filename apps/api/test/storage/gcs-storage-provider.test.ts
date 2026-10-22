import { describe, expect, it, vi } from 'vitest'

import { GcsStorageProvider } from '../../src/storage/gcs-storage.provider'

/**
 * GCS object names are flat strings, so folder semantics come entirely from
 * the prefix/delimiter the provider sends. A fake bucket records them; the
 * constructor's real Storage client is never asked to make a request.
 */
function makeProvider() {
    const bucket = {
        getFiles: vi.fn(() => Promise.resolve([[{ name: 'recordings/u/s/r/audio.webm' }]])),
        deleteFiles: vi.fn(() => Promise.resolve()),
    }
    const provider = new GcsStorageProvider('test-bucket')
    ;(provider as unknown as { bucket: typeof bucket }).bucket = bucket
    return { provider, bucket }
}

describe('GcsStorageProvider folders', () => {
    it("lists only the folder's own objects: trailing slash plus delimiter, with or without the caller's slash", async () => {
        const { provider, bucket } = makeProvider()
        await expect(provider.list('recordings/u/s/r')).resolves.toEqual(['recordings/u/s/r/audio.webm'])
        await provider.list('recordings/u/s/r/')
        expect(bucket.getFiles).toHaveBeenNthCalledWith(1, { prefix: 'recordings/u/s/r/', delimiter: '/' })
        expect(bucket.getFiles).toHaveBeenNthCalledWith(2, { prefix: 'recordings/u/s/r/', delimiter: '/' })
    })

    it('deletes inside the folder only, so recordings/u1 cannot match recordings/u10', async () => {
        const { provider, bucket } = makeProvider()
        await provider.deleteFolder('recordings/u1')
        await provider.deleteFolder('recordings/u1/')
        expect(bucket.deleteFiles).toHaveBeenNthCalledWith(1, { prefix: 'recordings/u1/' })
        expect(bucket.deleteFiles).toHaveBeenNthCalledWith(2, { prefix: 'recordings/u1/' })
    })

    it('refuses an empty folder instead of listing or wiping the whole bucket', async () => {
        const { provider, bucket } = makeProvider()
        for (const folder of ['', '/', '//']) {
            await expect(provider.deleteFolder(folder)).rejects.toThrow(/whole store/)
            await expect(provider.list(folder)).rejects.toThrow(/whole store/)
        }
        expect(bucket.deleteFiles).not.toHaveBeenCalled()
        expect(bucket.getFiles).not.toHaveBeenCalled()
    })
})
