import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { RealSecretsManagerClient } from '../real-secrets-manager-client.js'

/** Network-free SecretsManagerClient double: dispatches on the command class name over an in-memory map. */
class FakeSecretsManagerClient
{
    public static readonly NotFoundMessage = "Secrets Manager can't find the specified secret."
    public static readonly ExistsMessage = 'The operation failed because the secret already exists.'
    public static readonly DeniedMessage = 'User is not authorized to perform this action.'
    public static readonly DeniedName = 'AccessDeniedException'

    private static readonly GetCommand = 'GetSecretValueCommand'
    private static readonly CreateCommand = 'CreateSecretCommand'
    private static readonly PutCommand = 'PutSecretValueCommand'
    private static readonly DeleteCommand = 'DeleteSecretCommand'
    private static readonly NotFoundName = 'ResourceNotFoundException'
    private static readonly ExistsName = 'ResourceExistsException'
    private static readonly UnexpectedMessage = 'unexpected command'

    public readonly Secrets = new Map<string, string>()
    public Thrown: Error | undefined
    public FailWith: Error | undefined

    public async send(command: { constructor: { name: string }, input: Record<string, unknown> }): Promise<Record<string, unknown>>
    {
        if (this.FailWith !== undefined)
        {
            this.Thrown = this.FailWith
            throw this.FailWith
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
                this.Secrets.set(id, '')
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

    private Named(message: string, name: string): Error
    {
        return Object.assign(new Error(message), { name })
    }
}

class Fixture
{
    public static readonly Id = 'secret-one'
    public static readonly ValueA = 'value-a'
    public static readonly ValueB = 'value-b'

    public readonly Fake = new FakeSecretsManagerClient()
    public readonly Client = new RealSecretsManagerClient(this.Fake as unknown as SecretsManagerClient)
}

test('AccessLatest on a missing secret returns undefined', async () =>
{
    assert.equal(await new Fixture().Client.AccessLatest(Fixture.Id), undefined)
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

test('a non-NotFound error propagates from AccessLatest and DeleteSecret', async () =>
{
    const f = new Fixture()
    f.Fake.FailWith = f.Fake.Denied()
    await assert.rejects(() => f.Client.AccessLatest(Fixture.Id), { name: FakeSecretsManagerClient.DeniedName })
    await assert.rejects(() => f.Client.DeleteSecret(Fixture.Id), { name: FakeSecretsManagerClient.DeniedName })
})

test('a propagated error is the original object with no added message', async () =>
{
    const f = new Fixture()
    f.Fake.FailWith = f.Fake.Denied()
    let caught: unknown
    try
    {
        await f.Client.AccessLatest(Fixture.Id)
    }
    catch (e)
    {
        caught = e
    }
    assert.equal(caught, f.Fake.Thrown)
    assert.equal((caught as Error).name, FakeSecretsManagerClient.DeniedName)
    assert.equal((caught as Error).message, FakeSecretsManagerClient.DeniedMessage)
})
