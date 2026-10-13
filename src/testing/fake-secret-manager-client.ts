import type { ISecretManagerClient } from '../secrets/secret-manager-client.js'

/** In-memory ISecretManagerClient. A secret may exist without a version (EnsureSecret only). */
export class FakeSecretManagerClient implements ISecretManagerClient
{
    private readonly secrets = new Map<string, string | undefined>()

    public async AccessLatest(secretId: string): Promise<string | undefined>
    {
        return this.secrets.get(secretId)
    }

    public async EnsureSecret(secretId: string): Promise<void>
    {
        if (!this.secrets.has(secretId))
        {
            this.secrets.set(secretId, undefined)
        }
    }

    public async AddVersion(secretId: string, value: string): Promise<void>
    {
        this.secrets.set(secretId, value)
    }

    public async DeleteSecret(secretId: string): Promise<void>
    {
        this.secrets.delete(secretId)
    }
}
