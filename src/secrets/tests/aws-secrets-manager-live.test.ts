import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import type { ISecretStore } from '@pragmatic-tech-ai/todl-identity'
import { AwsSecretsManagerSecretStore } from '../aws-secrets-manager-secret-store.js'
import { RealSecretsManagerClient } from '../real-secrets-manager-client.js'

/** Gated: runs store-level conformance against the real SDK + RealSecretsManagerClient pointed at a
 *  Secrets Manager emulator. Skips unless PRAGMATIC_TEST_SECRETS_ENDPOINT is set. Logs nothing. */
class LiveSecretsManagerConformance
{
    private static readonly EndpointVar = 'PRAGMATIC_TEST_SECRETS_ENDPOINT'
    private static readonly RegionVar = 'PRAGMATIC_TEST_SECRETS_REGION'
    private static readonly DefaultRegion = 'us-east-1'
    private static readonly TestCredential = 'test'
    private static readonly SkipReason = 'set PRAGMATIC_TEST_SECRETS_ENDPOINT to run'
    private static readonly RunPrefix = 'run-'
    private static readonly Separator = '/'
    private static readonly AbsentName = 'absent'
    private static readonly RoundTripName = 'roundtrip'
    private static readonly OverwriteName = 'overwrite'
    private static readonly DeleteName = 'delete'
    private static readonly DeleteMissingName = 'delete-missing'
    private static readonly ValueA = 'value-a'
    private static readonly ValueB = 'value-b'

    private readonly endpoint: string | undefined = process.env[LiveSecretsManagerConformance.EndpointVar]
    private readonly runId: string = LiveSecretsManagerConformance.RunPrefix + randomBytes(8).toString('hex')
    private readonly created: string[] = []
    private store: ISecretStore | undefined

    public Register(): void
    {
        const cases: Array<[string, () => Promise<void>]> = [
            ['Get of an absent reference returns null', () => this.Absent()],
            ['Put then Get round-trips', () => this.RoundTrip()],
            ['a second Put overwrites the value', () => this.Overwrite()],
            ['Delete then Get returns null', () => this.DeleteThenGet()],
            ['Delete of a missing reference is a no-op', () => this.DeleteMissing()]
        ]
        const skip = this.endpoint === undefined ? LiveSecretsManagerConformance.SkipReason : false
        for (const [name, body] of cases)
        {
            test(name, { skip }, async () =>
            {
                let bodyError: unknown
                try
                {
                    await body()
                }
                catch (error)
                {
                    bodyError = error
                }
                try
                {
                    await this.CleanUp()
                }
                catch (cleanupError)
                {
                    // Never mask a real assertion error with a cleanup failure.
                    bodyError ??= cleanupError
                }
                if (bodyError !== undefined)
                {
                    throw bodyError
                }
            })
        }
    }

    private async Absent(): Promise<void>
    {
        assert.equal(await this.Store().Get(this.Ref(LiveSecretsManagerConformance.AbsentName)), null)
    }

    private async RoundTrip(): Promise<void>
    {
        const store = this.Store()
        const ref = this.Ref(LiveSecretsManagerConformance.RoundTripName)
        await store.Put(ref, LiveSecretsManagerConformance.ValueA)
        assert.equal(await store.Get(ref), LiveSecretsManagerConformance.ValueA)
    }

    private async Overwrite(): Promise<void>
    {
        const store = this.Store()
        const ref = this.Ref(LiveSecretsManagerConformance.OverwriteName)
        await store.Put(ref, LiveSecretsManagerConformance.ValueA)
        await store.Put(ref, LiveSecretsManagerConformance.ValueB)
        assert.equal(await store.Get(ref), LiveSecretsManagerConformance.ValueB)
    }

    private async DeleteThenGet(): Promise<void>
    {
        const store = this.Store()
        const ref = this.Ref(LiveSecretsManagerConformance.DeleteName)
        await store.Put(ref, LiveSecretsManagerConformance.ValueA)
        await store.Delete(ref)
        assert.equal(await store.Get(ref), null)
    }

    private async DeleteMissing(): Promise<void>
    {
        await this.Store().Delete(this.Ref(LiveSecretsManagerConformance.DeleteMissingName))
    }

    /** Unique per run so a shared emulator cannot collide; recorded for cleanup. */
    private Ref(name: string): string
    {
        const ref = this.runId + LiveSecretsManagerConformance.Separator + name
        this.created.push(ref)
        return ref
    }

    /** Lazily built so a skipped run never constructs the SDK client. */
    private Store(): ISecretStore
    {
        if (this.store === undefined)
        {
            const client = new SecretsManagerClient({
                endpoint: this.endpoint,
                region: process.env[LiveSecretsManagerConformance.RegionVar] ?? LiveSecretsManagerConformance.DefaultRegion,
                credentials: {
                    accessKeyId: LiveSecretsManagerConformance.TestCredential,
                    secretAccessKey: LiveSecretsManagerConformance.TestCredential
                }
            })
            this.store = new AwsSecretsManagerSecretStore(new RealSecretsManagerClient(client))
        }
        return this.store
    }

    /** Best-effort: delete every created ref even if one fails; rethrow the first failure afterwards. */
    private async CleanUp(): Promise<void>
    {
        const refs = this.created.splice(0)
        if (this.store === undefined)
        {
            return
        }
        let first: unknown
        for (const ref of refs)
        {
            try
            {
                await this.store.Delete(ref)
            }
            catch (error)
            {
                first ??= error
            }
        }
        if (first !== undefined)
        {
            throw first
        }
    }
}

new LiveSecretsManagerConformance().Register()
