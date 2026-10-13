import type { ISecretStore } from '@pragmatic-tech-ai/todl-identity'
import type { ISecretManagerClient } from './secret-manager-client.js'
import { SecretRefEncoding } from './secret-ref-encoding.js'

/** ISecretStore over AWS Secrets Manager via an injected client seam. Absence is null (Get) / no-op (Delete). */
export class AwsSecretsManagerSecretStore implements ISecretStore
{
    private readonly client: ISecretManagerClient

    public constructor(client: ISecretManagerClient)
    {
        this.client = client
    }

    public async Get(reference: string): Promise<string | null>
    {
        const value = await this.client.AccessLatest(SecretRefEncoding.ToSecretId(reference))
        return value ?? null
    }

    public async Put(reference: string, secret: string): Promise<void>
    {
        const id = SecretRefEncoding.ToSecretId(reference)
        await this.client.EnsureSecret(id)
        await this.client.AddVersion(id, secret)
    }

    public async Delete(reference: string): Promise<void>
    {
        await this.client.DeleteSecret(SecretRefEncoding.ToSecretId(reference))
    }
}
