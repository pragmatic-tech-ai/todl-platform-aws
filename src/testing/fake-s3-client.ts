/** Network-free structural double of the S3Client surface RealS3Bucket uses. Branches on the command class
 *  name and is backed by an in-memory map keyed by full object key. */
export class FakeS3Client
{
    private static readonly PutName = 'PutObjectCommand'
    private static readonly GetName = 'GetObjectCommand'
    private static readonly DeleteName = 'DeleteObjectCommand'
    private static readonly ListName = 'ListObjectsV2Command'
    private static readonly NoSuchKeyName = 'NoSuchKey'

    public readonly BodylessKeys = new Set<string>()
    public readonly Objects = new Map<string, Uint8Array>()
    public PageSize = 1000

    public async send(command: { constructor: { name: string }, input: any }): Promise<any>
    {
        const input = command.input
        switch (command.constructor.name)
        {
            case FakeS3Client.PutName:
                this.Objects.set(input.Key, new Uint8Array(input.Body))
                return {}
            case FakeS3Client.GetName:
            {
                const stored = this.Objects.get(input.Key)
                if (stored === undefined)
                {
                    throw Object.assign(new Error('The specified key does not exist.'), { name: FakeS3Client.NoSuchKeyName })
                }
                if (this.BodylessKeys.has(input.Key))
                {
                    return {}
                }
                return { Body: { transformToByteArray: async () => stored } }
            }
            case FakeS3Client.DeleteName:
                this.Objects.delete(input.Key)
                return {}
            case FakeS3Client.ListName:
                return this.List(input.Prefix ?? '', input.ContinuationToken)
            default:
                throw new Error('unexpected command ' + command.constructor.name)
        }
    }

    private List(prefix: string, token: string | undefined): any
    {
        const all = [...this.Objects.keys()].filter(k => k.startsWith(prefix)).sort()
        const start = token === undefined ? 0 : Number(token)
        const end = start + this.PageSize
        const truncated = end < all.length
        return {
            Contents: all.slice(start, end).map(Key => ({ Key })),
            IsTruncated: truncated,
            NextContinuationToken: truncated ? String(end) : undefined
        }
    }
}
