/** Maps an ISecretStore reference (which may contain '/' and other chars) to a valid AWS Secrets Manager
 *  secret id ([A-Za-z0-9_-], <=255, not starting with '-'/'_'). base64url is injective and uses exactly the
 *  allowed alphabet; a fixed leading letter avoids a '-'/'_' start. Not reversed anywhere (the store never
 *  enumerates ids back to references), so a one-way deterministic injective map suffices. */
export class SecretRefEncoding
{
    private static readonly Prefix = 'r-'
    private static readonly MaxIdLength = 255
    private static readonly TooLongMessage = 'Secret reference is too long to encode as a Secret Manager id'

    public static ToSecretId(reference: string): string
    {
        const id = SecretRefEncoding.Prefix + Buffer.from(reference, 'utf8').toString('base64url')
        if (id.length > SecretRefEncoding.MaxIdLength)
        {
            throw new Error(SecretRefEncoding.TooLongMessage)
        }
        return id
    }
}
