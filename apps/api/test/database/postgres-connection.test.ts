import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { postgresSsl, postgresUrl } from '../../src/database/postgres-connection'

const ENV_KEYS = [
    'NODE_ENV',
    'POSTGRES_URL',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
    'POSTGRES_SSL',
    'POSTGRES_SSL_CA',
] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
})

describe('postgresUrl', () => {
    it('uses POSTGRES_URL verbatim when set', () => {
        process.env.POSTGRES_URL = 'postgres://app:secret@db.internal:5432/solkey'
        process.env.POSTGRES_HOST = 'ignored'
        expect(postgresUrl()).toBe('postgres://app:secret@db.internal:5432/solkey')
    })

    it('assembles the local dev URL from the defaults', () => {
        expect(postgresUrl()).toBe('postgres://mushee:mushee@localhost:5632/mushee')
    })

    it('percent-encodes credentials so special characters still parse', () => {
        process.env.POSTGRES_USER = 'app'
        process.env.POSTGRES_PASSWORD = 'p@ss:w/rd#%'
        process.env.POSTGRES_HOST = 'db'
        process.env.POSTGRES_PORT = '5432'
        const url = new URL(postgresUrl())
        expect(url.hostname).toBe('db')
        expect(url.port).toBe('5432')
        expect(decodeURIComponent(url.password)).toBe('p@ss:w/rd#%')
    })

    it('refuses the dev credentials in production', () => {
        process.env.NODE_ENV = 'production'
        expect(() => postgresUrl()).toThrow(/POSTGRES_URL or POSTGRES_PASSWORD must be set in production/)
        process.env.POSTGRES_PASSWORD = 'real'
        expect(postgresUrl()).toBe('postgres://mushee:real@localhost:5632/mushee')
        delete process.env.POSTGRES_PASSWORD
        process.env.POSTGRES_URL = 'postgres://app:secret@db/solkey'
        expect(postgresUrl()).toBe('postgres://app:secret@db/solkey')
    })
})

describe('postgresSsl', () => {
    it('is plaintext unless POSTGRES_SSL asks for TLS', () => {
        expect(postgresSsl()).toBe(false)
        process.env.POSTGRES_SSL = 'false'
        expect(postgresSsl()).toBe(false)
        process.env.POSTGRES_SSL = 'require'
        expect(postgresSsl()).toEqual({ rejectUnauthorized: false })
        process.env.POSTGRES_SSL = 'verify'
        process.env.POSTGRES_SSL_CA = 'PEM'
        expect(postgresSsl()).toEqual({ rejectUnauthorized: true, ca: 'PEM' })
    })
})
