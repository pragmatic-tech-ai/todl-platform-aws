import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RdsAuthMode, RdsPoolFactory } from '../rds-pool-factory.js'
import type { IRdsPoolOptions, IRdsSigner } from '../rds-pool-factory.js'

class RdsFixture
{
    public static readonly Host = 'db.example.internal'
    public static readonly Port = 5432
    public static readonly User = 'app'
    public static readonly Database = 'appdb'
    public static readonly Token = 'dummy-token'
    public static readonly Secret = 'dummy-pw'

    public signerCalls = 0
    public endCalls = 0
    public cfg: Record<string, unknown> = {}

    public Options(extra: Partial<IRdsPoolOptions> = {}): IRdsPoolOptions
    {
        return { host: RdsFixture.Host, port: RdsFixture.Port, user: RdsFixture.User, database: RdsFixture.Database, ...extra }
    }

    public Factory(extra: Partial<IRdsPoolOptions> = {}): RdsPoolFactory
    {
        const signer: IRdsSigner = {
            getAuthToken: async () =>
            {
                this.signerCalls++
                return RdsFixture.Token
            }
        }
        return new RdsPoolFactory(
            this.Options(extra),
            () => signer,
            cfg =>
            {
                this.cfg = cfg
                return { end: async () => { this.endCalls++ } }
            })
    }
}

test('IAM mode: ssl set and password is a function minting a fresh token per call', async () =>
{
    const f = new RdsFixture()
    await f.Factory().Create()
    assert.ok(f.cfg.ssl)
    assert.equal(typeof f.cfg.password, 'function')
    assert.equal(f.signerCalls, 0)
    const mint = f.cfg.password as () => Promise<string>
    assert.equal(await mint(), RdsFixture.Token)
    assert.equal(f.signerCalls, 1)
    assert.equal(await mint(), RdsFixture.Token)
    assert.equal(f.signerCalls, 2)
})

test('PASSWORD mode: provided string used, signer never called, ssl set', async () =>
{
    const f = new RdsFixture()
    await f.Factory({ authMode: RdsAuthMode.Password, password: RdsFixture.Secret }).Create()
    assert.equal(f.cfg.password, RdsFixture.Secret)
    assert.ok(f.cfg.ssl)
    assert.equal(f.signerCalls, 0)
})

test('Dispose ends the pool exactly once', async () =>
{
    const f = new RdsFixture()
    const handle = await f.Factory().Create()
    await handle.Dispose()
    assert.equal(f.endCalls, 1)
})

test('host/port/user/database threaded into cfg and max is 10', async () =>
{
    const f = new RdsFixture()
    await f.Factory().Create()
    assert.equal(f.cfg.host, RdsFixture.Host)
    assert.equal(f.cfg.port, RdsFixture.Port)
    assert.equal(f.cfg.user, RdsFixture.User)
    assert.equal(f.cfg.database, RdsFixture.Database)
    assert.equal(f.cfg.max, 10)
})
