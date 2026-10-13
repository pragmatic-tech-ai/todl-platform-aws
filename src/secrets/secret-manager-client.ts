/** The narrow subset of a cloud secret manager the store needs. Injected so the store is unit-testable
 *  against a fake and integration-tested against a real/emulated Secret Manager. secretId is already an
 *  encoded, valid id (no project path). AccessLatest returns undefined when the secret or its latest
 *  version is absent. */
export interface ISecretManagerClient
{
    AccessLatest(secretId: string): Promise<string | undefined>
    EnsureSecret(secretId: string): Promise<void>
    AddVersion(secretId: string, value: string): Promise<void>
    DeleteSecret(secretId: string): Promise<void>
}
