import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BRAND } from '@/lib/brandColors'

// Path arithmetic rather than `new URL(…, import.meta.url)`: happy-dom's URL global doesn't do file URLs.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/globals.css'), 'utf8')

/** The @theme value of `--color-<name>`. */
const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(css)?.[1]?.toLowerCase()

describe('BRAND', () => {
    it('mirrors the globals.css @theme tokens it names', () => {
        const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
        for (const [key, hex] of Object.entries(BRAND)) {
            expect(token(kebab(key)), key).toBe(hex)
        }
    })
})
