/** Network-free structural double of the S3Client surface RealS3Bucket uses. Branches on the command class
 *  name and is backed by an in-memory map keyed by full object key. */
export class FakeS3Client
{
    public readonly Objects = new Map<string, Uint8Array>()
    public PageSize = 1000

    public async send(command: { constructor: { name: string }, input: any }): Promise<any>
    {
        const input = command.input
        switch (command.constructor.name)
        {
            case 'PutObjectCommand':
                this.Objects.set(input.Key, new Uint8Array(input.Body))
                return {}
            case 'GetObjectCommand':
            {
                const stored = this.Objects.get(input.Key)
                if (stored === undefined)
                {
                    throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
                }
                return { Body: { transformToByteArray: async () => stored } }
            }
            case 'DeleteObjectCommand':
                this.Objects.delete(input.Key)
                return {}
            case 'ListObjectsV2Command':
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
