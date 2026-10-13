import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { S3Client } from '@aws-sdk/client-s3'
import { S3StorageProviderRegistry } from '../s3-storage-provider-registry.js'
import { FakeS3Client } from '../../testing/fake-s3-client.js'

class Fixture
{
    public readonly Sdk = new FakeS3Client()
    public readonly Registry = new S3StorageProviderRegistry(this.Sdk as unknown as S3Client, 'bkt', 'base/')
}

test('a repeated location returns the same cached store and shares state', async () =>
{
    const f = new Fixture()
    const a = f.Registry.CreateStorage('t1')
    assert.equal(f.Registry.CreateStorage('t1'), a)
    await a.WriteText('x.txt', 'hello')
    assert.equal(await f.Registry.CreateStorage('t1').ReadText('x.txt'), 'hello')
    assert.ok(f.Sdk.Objects.has('base/t1/x.txt'))
})

test('different locations are isolated by prefix', async () =>
{
    const f = new Fixture()
    const a = f.Registry.CreateStorage('t1')
    const b = f.Registry.CreateStorage('t2')
    assert.notEqual(a, b)
    await a.WriteText('x.txt', 'hello')
    await assert.rejects(() => b.ReadText('x.txt'), /ENOENT/)
    assert.deepEqual([...f.Sdk.Objects.keys()], ['base/t1/x.txt'])
})

test('Root carries s3://bucket/basePrefix/location/', () =>
{
    const f = new Fixture()
    assert.equal(f.Registry.CreateStorage('t1').Root, 's3://bkt/base/t1/')
})
