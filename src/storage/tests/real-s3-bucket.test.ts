import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { S3Client } from '@aws-sdk/client-s3'
import { RealS3Bucket } from '../real-s3-bucket.js'
import { FakeS3Client } from '../../testing/fake-s3-client.js'

class Fixture
{
    public readonly Fake = new FakeS3Client()
    public readonly Bucket = new RealS3Bucket(this.Fake as unknown as S3Client, 'bkt', 'pfx/')
}

test('Save then Download round-trips raw bytes 0-255', async () =>
{
    const f = new Fixture()
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    await f.Bucket.Save('a.bin', bytes)
    assert.ok(f.Fake.Objects.has('pfx/a.bin'))
    assert.deepEqual(await f.Bucket.Download('a.bin'), bytes)
})

test('Download of a missing key returns undefined', async () =>
{
    assert.equal(await new Fixture().Bucket.Download('nope'), undefined)
})

test('Download maps a 404 status to undefined and rethrows other errors', async () =>
{
    const notFound = { send: async () => { throw Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } }) } }
    assert.equal(await new RealS3Bucket(notFound as unknown as S3Client, 'b', '').Download('k'), undefined)
    const broken = { send: async () => { throw Object.assign(new Error('boom'), { name: 'AccessDenied' }) } }
    await assert.rejects(() => new RealS3Bucket(broken as unknown as S3Client, 'b', '').Download('k'), /boom/)
})

test('Delete removes the object and tolerates a missing key', async () =>
{
    const f = new Fixture()
    await f.Bucket.Save('a', new Uint8Array([1]))
    await f.Bucket.Delete('a')
    await f.Bucket.Delete('a')
    assert.equal(f.Fake.Objects.size, 0)
})

test('ListKeys strips the prefix and ignores other prefixes', async () =>
{
    const f = new Fixture()
    await f.Bucket.Save('a.txt', new Uint8Array([1]))
    await f.Bucket.Save('dir/b.txt', new Uint8Array([2]))
    f.Fake.Objects.set('other/c.txt', new Uint8Array([3]))
    assert.deepEqual([...await f.Bucket.ListKeys()].sort(), ['a.txt', 'dir/b.txt'])
})

test('ListKeys follows continuation tokens across pages', async () =>
{
    const f = new Fixture()
    f.Fake.PageSize = 2
    for (const n of ['a', 'b', 'c', 'd', 'e'])
    {
        await f.Bucket.Save(n, new Uint8Array([1]))
    }
    assert.deepEqual([...await f.Bucket.ListKeys()].sort(), ['a', 'b', 'c', 'd', 'e'])
})

test('Download rejects (not undefined) when a successful GET has no body', async () =>
{
    const f = new Fixture()
    await f.Bucket.Save('a', new Uint8Array([1]))
    f.Fake.BodylessKeys.add('pfx/a')
    await assert.rejects(() => f.Bucket.Download('a'), /no body/)
})
