import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import {
    CreateSecretCommand,
    DeleteSecretCommand,
    GetSecretValueCommand,
    PutSecretValueCommand
} from '@aws-sdk/client-secrets-manager'
import type { ISecretManagerClient } from './secret-manager-client.js'

/** ISecretManagerClient over the real @aws-sdk/client-secrets-manager client. Maps ResourceNotFoundException
 *  to "absent" and ResourceExistsException on create to a no-op; every other error is rethrown untouched
 *  (fail-closed). Logs nothing and adds no message carrying a secret id or value. */
export class RealSecretsManagerClient implements ISecretManagerClient
{
    private static readonly ResourceNotFound = 'ResourceNotFoundException'
    private static readonly ResourceExists = 'ResourceExistsException'
    private static readonly Utf8 = 'utf8'

    public constructor(private readonly client: SecretsManagerClient)
    {
    }

    public async AccessLatest(secretId: string): Promise<string | undefined>
    {
        try
        {
            const out = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }))
            if (out.SecretString !== undefined)
            {
                return out.SecretString
            }
            if (out.SecretBinary !== undefined)
            {
                return Buffer.from(out.SecretBinary).toString(RealSecretsManagerClient.Utf8)
            }
            return undefined
        }
        catch (e)
        {
            if (this.NameOf(e) === RealSecretsManagerClient.ResourceNotFound)
            {
                return undefined
            }
            throw e
        }
    }

    public async EnsureSecret(secretId: string): Promise<void>
    {
        try
        {
            await this.client.send(new CreateSecretCommand({ Name: secretId }))
        }
        catch (e)
        {
            if (this.NameOf(e) === RealSecretsManagerClient.ResourceExists)
            {
                return
            }
            throw e
        }
    }

    public async AddVersion(secretId: string, value: string): Promise<void>
    {
        await this.client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }))
    }

    public async DeleteSecret(secretId: string): Promise<void>
    {
        try
        {
            await this.client.send(new DeleteSecretCommand({ SecretId: secretId, ForceDeleteWithoutRecovery: true }))
        }
        catch (e)
        {
            if (this.NameOf(e) === RealSecretsManagerClient.ResourceNotFound)
            {
                return
            }
            throw e
        }
    }

    private NameOf(e: unknown): string | undefined
    {
        const name = (e as { name?: unknown } | null | undefined)?.name
        return typeof name === 'string' ? name : undefined
    }
}
