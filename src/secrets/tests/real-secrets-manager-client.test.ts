import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { RealSecretsManagerClient } from '../real-secrets-manager-client.js'

/** Network-free SecretsManagerClient double: dispatches on the command class name over an in-memory map.
 *  A value of undefined models a secret that exists but has no current version (real AWS throws NotFound on read). */
class FakeSecretsManagerClient
{
    public static readonly NotFoundMessage = "Secrets Manager can't find the specified secret."
    public static readonly ExistsMessage = 'The operation failed because the secret already exists.'
    public static readonly DeniedMessage = 'User is not authorized to perform this action.'
    public static readonly DeniedName = 'AccessDeniedException'
    public static readonly NotFoundName = 'ResourceNotFoundException'
    public static readonly ExistsName = 'ResourceExistsException'

    private static readonly GetCommand = 'GetSecretValueCommand'
    private static readonly CreateCommand = 'CreateSecretCommand'
    private static readonly PutCommand = 'PutSecretValueCommand'
    private static readonly DeleteCommand = 'DeleteSecretCommand'
    private static readonly UnexpectedMessage = 'unexpected command'

    public readonly Secrets = new Map<string, string | undefined>()
    public Thrown: unknown
    public FailWith: { value: unknown } | undefined

    public async send(command: { constructor: { name: string }, input: Record<string, unknown> }): Promise<Record<string, unknown>>
    {
        if (this.FailWith !== undefined)
        {
            this.Thrown = this.FailWith.value
            throw this.FailWith.value
        }
        const input = command.input
        switch (command.constructor.name)
        {
            case FakeSecretsManagerClient.GetCommand:
            {
                const v = this.Secrets.get(input.SecretId as string)
                if (v === undefined)
                {
                    throw this.Named(FakeSecretsManagerClient.NotFoundMessage, FakeSecretsManagerClient.NotFoundName)
                }
                return { SecretString: v }
            }
            case FakeSecretsManagerClient.CreateCommand:
            {
                const id = input.Name as string
                if (this.Secrets.has(id))
                {
                    throw this.Named(FakeSecretsManagerClient.ExistsMessage, FakeSecretsManagerClient.ExistsName)
                }
                this.Secrets.set(id, undefined)
                return {}
            }
            case FakeSecretsManagerClient.PutCommand:
                this.Secrets.set(input.SecretId as string, input.SecretString as string)
                return {}
            case FakeSecretsManagerClient.DeleteCommand:
                if (!this.Secrets.delete(input.SecretId as string))
                {
                    throw this.Named(FakeSecretsManagerClient.NotFoundMessage, FakeSecretsManagerClient.NotFoundName)
                }
                return {}
            default:
                throw new Error(FakeSecretsManagerClient.UnexpectedMessage)
        }
    }

    public Denied(): Error
    {
        return this.Named(FakeSecretsManagerClient.DeniedMessage, FakeSecretsManagerClient.DeniedName)
    }

    public Named(message: string, name: string): Error
    {
        return Object.assign(new Error(message), { name })
    }
}

class Fixture
{
    public static readonly Id = 'secret-one'
    public static readonly ValueA = 'value-a'
    public static readonly ValueB = 'value-b'
    public static readonly StringThrown = 'x'

    public readonly Fake = new FakeSecretsManagerClient()
    public readonly Client = new RealSecretsManagerClient(this.Fake as unknown as SecretsManagerClient)

    /** Every seam operation, so propagation checks cover all four. */
    public Operations(): Array<() => Promise<unknown>>
    {
        return [
            () => this.Client.AccessLatest(Fixture.Id),
            () => this.Client.EnsureSecret(Fixture.Id),
            () => this.Client.AddVersion(Fixture.Id, Fixture.ValueA),
            () => this.Client.DeleteSecret(Fixture.Id)
        ]
    }

    /** Runs op against a failing fake; returns what it rejected with (fails the test if it resolved). */
    public async Caught(op: () => Promise<unknown>, thrown: unknown): Promise<unknown>
    {
        this.Fake.FailWith = { value: thrown }
        let caught: unknown
        let rejected = false
        try
        {
            await op()
        }
        catch (e)
        {
            caught = e
            rejected = true
        }
        assert.ok(rejected, 'operation must reject')
        return caught
    }
}

test('AccessLatest on a missing secret returns undefined', async () =>
{
    assert.equal(await new Fixture().Client.AccessLatest(Fixture.Id), undefined)
})

test('AccessLatest after EnsureSecret without AddVersion returns undefined', async () =>
{
    const f = new Fixture()
    await f.Client.EnsureSecret(Fixture.Id)
    assert.equal(await f.Client.AccessLatest(Fixture.Id), undefined)
})

test('EnsureSecret twice is idempotent', async () =>
{
    const f = new Fixture()
    await f.Client.EnsureSecret(Fixture.Id)
    await f.Client.EnsureSecret(Fixture.Id)
    assert.ok(f.Fake.Secrets.has(Fixture.Id))
})

test('EnsureSecret + AddVersion then AccessLatest returns the value', async () =>
{
    const f = new Fixture()
    await f.Client.EnsureSecret(Fixture.Id)
    await f.Client.AddVersion(Fixture.Id, Fixture.ValueA)
    assert.equal(await f.Client.AccessLatest(Fixture.Id), Fixture.ValueA)
})

test('AddVersion overwrite changes the value', async () =>
{
    const f = new Fixture()
    await f.Client.EnsureSecret(Fixture.Id)
    await f.Client.AddVersion(Fixture.Id, Fixture.ValueA)
    await f.Client.AddVersion(Fixture.Id, Fixture.ValueB)
    assert.equal(await f.Client.AccessLatest(Fixture.Id), Fixture.ValueB)
})

test('DeleteSecret on a missing secret is a no-op; after delete AccessLatest is undefined', async () =>
{
    const f = new Fixture()
    await f.Client.DeleteSecret(Fixture.Id)
    await f.Client.AddVersion(Fixture.Id, Fixture.ValueA)
    await f.Client.DeleteSecret(Fixture.Id)
    assert.equal(await f.Client.AccessLatest(Fixture.Id), undefined)
})

test('a non-benign error propagates as the same object, with no added message, from every operation', async () =>
{
    const f = new Fixture()
    for (const op of f.Operations())
    {
        const caught = await f.Caught(op, f.Fake.Denied())
        assert.equal(caught, f.Fake.Thrown)
        assert.equal((caught as Error).name, FakeSecretsManagerClient.DeniedName)
        assert.equal((caught as Error).message, FakeSecretsManagerClient.DeniedMessage)
    }
})

test('ResourceExists propagates from AccessLatest and DeleteSecret', async () =>
{
    const f = new Fixture()
    const exists = f.Fake.Named(FakeSecretsManagerClient.ExistsMessage, FakeSecretsManagerClient.ExistsName)
    assert.equal(await f.Caught(() => f.Client.AccessLatest(Fixture.Id), exists), exists)
    assert.equal(await f.Caught(() => f.Client.DeleteSecret(Fixture.Id), exists), exists)
})

test('ResourceNotFound propagates from EnsureSecret and AddVersion', async () =>
{
    const f = new Fixture()
    const notFound = f.Fake.Named(FakeSecretsManagerClient.NotFoundMessage, FakeSecretsManagerClient.NotFoundName)
    assert.equal(await f.Caught(() => f.Client.EnsureSecret(Fixture.Id), notFound), notFound)
    assert.equal(await f.Caught(() => f.Client.AddVersion(Fixture.Id, Fixture.ValueA), notFound), notFound)
})

test('a thrown value with a non-string or absent name propagates from every operation', async () =>
{
    const f = new Fixture()
    for (const thrown of [Fixture.StringThrown, {}, { name: 42 }, null])
    {
        for (const op of f.Operations())
        {
            assert.equal(await f.Caught(op, thrown), thrown)
        }
    }
})
