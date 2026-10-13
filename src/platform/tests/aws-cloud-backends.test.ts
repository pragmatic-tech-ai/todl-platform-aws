import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { S3Client } from '@aws-sdk/client-s3'
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { PgSession } from '@pragmatic-tech-ai/todl-platform-cloud'
import { newDb } from 'pg-mem'
import type pg from 'pg'
import { AwsCloudBackends } from '../aws-cloud-backends.js'
import type { IAwsCloudBackendsConfig, IAwsCloudBackendsFactories } from '../aws-cloud-backends.js'
import type { IRdsPoolHandle } from '../../sql/rds-pool-factory.js'
import { SecretRefEncoding } from '../../secrets/secret-ref-encoding.js'

/** Minimal SecretsManagerClient double: answers GetSecretValueCommand from a map, NotFound otherwise. */
class FakeSecretsClient
{
    private static readonly NotFoundName = 'ResourceNotFoundException'
    private static readonly NotFoundMessage = 'not found'

    public readonly Secrets = new Map<string, string>()

    public async send(command: { input: { SecretId: string } }): Promise<Record<string, unknown>>
    {
        const v = this.Secrets.get(command.input.SecretId)
        if (v === undefined)
        {
            throw Object.assign(new Error(FakeSecretsClient.NotFoundMessage), { name: FakeSecretsClient.NotFoundName })
        }
        return { SecretString: v }
    }
}

class BackendsFixture
{
    public static readonly Ref = 'secret-ref-xyz'
    public static readonly PasswordValue = 'pw-value-123'
    public static readonly Unset = 'unset'

    public readonly Secrets = new FakeSecretsClient()
    public DisposeCalls = 0
    public PoolCalls = 0
    public PasswordArg: string | undefined = BackendsFixture.Unset

    public static Config(extra: Partial<IAwsCloudBackendsConfig> = {}): IAwsCloudBackendsConfig
    {
        return { s3Bucket: 'b', awsRegion: 'us-east-1', rdsHost: 'h', rdsUser: 'u', rdsDatabase: 'd', ...extra }
    }

    public Factories(): IAwsCloudBackendsFactories
    {
        return {
            CreateS3Client: () => ({}) as unknown as S3Client,
            CreateSecretsManagerClient: () => this.Secrets as unknown as SecretsManagerClient,
            CreatePool: async (_config, password) =>
            {
                this.PoolCalls++
                this.PasswordArg = password
                const { Pool } = newDb().adapters.createPg()
                const handle: IRdsPoolHandle = {
                    Pool: new Pool() as pg.Pool,
                    Dispose: async () =>
                    {
                        this.DisposeCalls++
                    }
                }
                return handle
            }
        }
    }
}

test('IAM auth builds backends with no password', async () =>
{
    for (const rdsAuth of [undefined, 'iam'])
    {
        const f = new BackendsFixture()
        const b = await AwsCloudBackends.Create(BackendsFixture.Config({ rdsAuth }), f.Factories())
        assert.ok(b.Storage)
        assert.ok(b.SecretManager)
        assert.ok(b.Session instanceof PgSession)
        assert.equal(f.PasswordArg, undefined)
    }
})

test('Dispose ends the pool exactly once', async () =>
{
    const f = new BackendsFixture()
    const b = await AwsCloudBackends.Create(BackendsFixture.Config(), f.Factories())
    await b.Dispose()
    assert.equal(f.DisposeCalls, 1)
})

test('PASSWORD auth resolves the password from the secret store', async () =>
{
    const f = new BackendsFixture()
    f.Secrets.Secrets.set(SecretRefEncoding.ToSecretId(BackendsFixture.Ref), BackendsFixture.PasswordValue)
    await AwsCloudBackends.Create(
        BackendsFixture.Config({ rdsAuth: 'password', rdsPasswordRef: BackendsFixture.Ref }), f.Factories())
    assert.equal(f.PasswordArg, BackendsFixture.PasswordValue)
})

test('PASSWORD auth without a ref rejects generically', async () =>
{
    const f = new BackendsFixture()
    await assert.rejects(
        AwsCloudBackends.Create(BackendsFixture.Config({ rdsAuth: 'password' }), f.Factories()),
        (e: Error) => !e.message.includes(BackendsFixture.Ref) && !e.message.includes(BackendsFixture.PasswordValue))
    assert.equal(f.PoolCalls, 0)
})

test('PASSWORD auth with an absent secret rejects generically', async () =>
{
    const f = new BackendsFixture()
    await assert.rejects(
        AwsCloudBackends.Create(
            BackendsFixture.Config({ rdsAuth: 'password', rdsPasswordRef: BackendsFixture.Ref }), f.Factories()),
        (e: Error) => e.message.length > 0 && !e.message.includes(BackendsFixture.Ref))
    assert.equal(f.PoolCalls, 0)
})

test('unknown rdsAuth rejects', async () =>
{
    const f = new BackendsFixture()
    await assert.rejects(
        AwsCloudBackends.Create(BackendsFixture.Config({ rdsAuth: 'bogus' }), f.Factories()),
        /Invalid rdsAuth/)
    assert.equal(f.PoolCalls, 0)
})
