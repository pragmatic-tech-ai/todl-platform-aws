import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AwsSecretsManagerSecretStore } from '../aws-secrets-manager-secret-store.js'
import { FakeSecretManagerClient } from '../../testing/fake-secret-manager-client.js'

class SecretStoreFixture
{
    public static readonly Ref = 'tenant/a/db-password'
    public static readonly RefSlashB = 't1/a/b'
    public static readonly RefSlashC = 't1/a/c'
    public static readonly ValueA = 'a'
    public static readonly ValueB = 'b'
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
    await store.Put(SecretStoreFixture.Ref, SecretStoreFixture.ValueA)
    assert.equal(await store.Get(SecretStoreFixture.Ref), SecretStoreFixture.ValueA)
    await store.Put(SecretStoreFixture.Ref, SecretStoreFixture.ValueB)
    assert.equal(await store.Get(SecretStoreFixture.Ref), SecretStoreFixture.ValueB)
})

test('Delete removes the secret and deleting a missing reference is a no-op', async () =>
{
    const store = SecretStoreFixture.Make()
    await store.Put(SecretStoreFixture.Ref, SecretStoreFixture.ValueA)
    await store.Delete(SecretStoreFixture.Ref)
    assert.equal(await store.Get(SecretStoreFixture.Ref), null)
    await assert.doesNotReject(store.Delete(SecretStoreFixture.Ref))
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
    await store.Put(SecretStoreFixture.RefSlashB, SecretStoreFixture.ValueA)
    await store.Put(SecretStoreFixture.RefSlashC, SecretStoreFixture.ValueB)
    assert.equal(await store.Get(SecretStoreFixture.RefSlashB), SecretStoreFixture.ValueA)
    assert.equal(await store.Get(SecretStoreFixture.RefSlashC), SecretStoreFixture.ValueB)
})
