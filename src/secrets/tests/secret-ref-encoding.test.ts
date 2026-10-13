import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SecretRefEncoding } from '../secret-ref-encoding.js'

class EncodingFixture
{
    public static readonly RefA = 'tenant/a/db-password'
    public static readonly RefB = 'tenant/b/db-password'
    public static readonly Prefix = 'r-'
    public static readonly AlphabetPattern = /^[A-Za-z0-9_-]+$/
    public static readonly OverLongLength = 300
    public static readonly OverLongChar = 'x'
}

test('ToSecretId is deterministic', () =>
{
    assert.equal(SecretRefEncoding.ToSecretId(EncodingFixture.RefA), SecretRefEncoding.ToSecretId(EncodingFixture.RefA))
})

test('ToSecretId is injective for distinct references', () =>
{
    assert.notEqual(SecretRefEncoding.ToSecretId(EncodingFixture.RefA), SecretRefEncoding.ToSecretId(EncodingFixture.RefB))
})

test('ToSecretId starts with the prefix and uses only the allowed alphabet', () =>
{
    const id = SecretRefEncoding.ToSecretId(EncodingFixture.RefA)
    assert.ok(id.startsWith(EncodingFixture.Prefix))
    assert.match(id, EncodingFixture.AlphabetPattern)
})

test('ToSecretId throws for an over-long reference without leaking it', () =>
{
    const ref = EncodingFixture.OverLongChar.repeat(EncodingFixture.OverLongLength)
    assert.throws(() => SecretRefEncoding.ToSecretId(ref), (error: unknown) =>
    {
        const message = (error as Error).message
        return !message.includes(ref) && !message.includes(EncodingFixture.OverLongChar.repeat(10))
    })
})
