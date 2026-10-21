import { describe, expect, it, vi } from 'vitest'

// The clef tables are read at module init by the layout and renderer modules, and the model
// imports its layout classes as values. A table that moved into a module sitting in a cycle
// with Clef.ts would be read before it is initialised (a TDZ ReferenceError at load time),
// which only shows in a fresh module graph — so load both entry points from scratch.
describe('package entry points', () => {
    it('load model first, then components, without an init-order error', async () => {
        vi.resetModules()
        const model = await import('@mushee/notation/model')
        const components = await import('@mushee/notation/components')
        expect(model.Clef).toBeTypeOf('function')
        expect(components.Score).toBeDefined()
    })

    it('load components first, then model, without an init-order error', async () => {
        vi.resetModules()
        const components = await import('@mushee/notation/components')
        const model = await import('@mushee/notation/model')
        expect(components.Score).toBeDefined()
        expect(model.Clef).toBeTypeOf('function')
    })
})
