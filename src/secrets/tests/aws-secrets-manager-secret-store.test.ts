import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AwsSecretsManagerSecretStore } from '../aws-secrets-manager-secret-store.js'
import { SecretRefEncoding } from '../secret-ref-encoding.js'
import { FakeSecretManagerClient } from '../../testing/fake-secret-manager-client.js'

class SecretStoreFixture
{
    public static readonly ValidIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/
    public static readonly Ref = 'tenant/a/db-password'
    public static readonly RefA = 'a/b'
    public static readonly RefB = 'a_b'
    public static readonly Utf8Value = 'line1\nline2 世界'

    public static Make(): AwsSecretsManagerSecretStore
    {
        return new AwsSecretsManagerSecretStore(new FakeSecretManagerClient())
    }
}

test('Get of a never-created reference returns null', async () =>
{
    const store = SecretStoreFixture.Make()
    assert.equal(await store.Get(SecretStoreFixture.Ref), null)
})

test('Put then Get round-trips and a second Put overwrites', async () =>
{
    const store = SecretStoreFixture.Make()
    await store.Put(SecretStoreFixture.Ref, 'a')
    assert.equal(await store.Get(SecretStoreFixture.Ref), 'a')
    await store.Put(SecretStoreFixture.Ref, 'b')
    assert.equal(await store.Get(SecretStoreFixture.Ref), 'b')
})

test('Delete removes the secret and deleting a missing reference is a no-op', async () =>
{
    const store = SecretStoreFixture.Make()
    await store.Put(SecretStoreFixture.Ref, 'a')
    await store.Delete(SecretStoreFixture.Ref)
    assert.equal(await store.Get(SecretStoreFixture.Ref), null)
    await assert.doesNotReject(store.Delete(SecretStoreFixture.Ref))
})

test('Get of a created-then-deleted reference returns null', async () =>
{
    const store = SecretStoreFixture.Make()
    await store.Put(SecretStoreFixture.Ref, 'x')
    await store.Delete(SecretStoreFixture.Ref)
    assert.equal(await store.Get(SecretStoreFixture.Ref), null)
})

test('reference encoding is injective, valid and stable', () =>
{
    const a = SecretRefEncoding.ToSecretId(SecretStoreFixture.RefA)
    const b = SecretRefEncoding.ToSecretId(SecretStoreFixture.RefB)
    assert.notEqual(a, b)
    assert.match(a, SecretStoreFixture.ValidIdPattern)
    assert.match(b, SecretStoreFixture.ValidIdPattern)
    assert.equal(SecretRefEncoding.ToSecretId(SecretStoreFixture.RefA), a)
})

test('reference encoding rejects an id longer than 255 characters', () =>
{
    assert.throws(() => SecretRefEncoding.ToSecretId('x'.repeat(300)))
})

test('a newline / utf-8 value round-trips', async () =>
{
    const store = SecretStoreFixture.Make()
    await store.Put(SecretStoreFixture.Ref, SecretStoreFixture.Utf8Value)
    assert.equal(await store.Get(SecretStoreFixture.Ref), SecretStoreFixture.Utf8Value)
})

test('two distinct references containing a slash do not collide', async () =>
{
    const store = SecretStoreFixture.Make()
    await store.Put('t1/a/b', 'one')
    await store.Put('t1/a/c', 'two')
    assert.equal(await store.Get('t1/a/b'), 'one')
    assert.equal(await store.Get('t1/a/c'), 'two')
    assert.notEqual(SecretRefEncoding.ToSecretId('t1/a/b'), SecretRefEncoding.ToSecretId('t1/a/c'))
})
