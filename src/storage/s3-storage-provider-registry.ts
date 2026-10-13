import type { S3Client } from '@aws-sdk/client-s3'
import type { IStorageProviderRegistry } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { S3ObjectStore } from './s3-object-store.js'
import { RealS3Bucket } from './real-s3-bucket.js'

/** S3 storage provider registry: one S3ObjectStore per location, each isolated under its own object-key
 *  prefix (`basePrefix/location/`) within a single bucket. A repeated location returns the cached store. */
export class S3StorageProviderRegistry implements IStorageProviderRegistry
{
    private static readonly Separator = '/'
    private static readonly RootScheme = 's3://'

    private readonly stores = new Map<string, S3ObjectStore>()
    private readonly client: S3Client
    private readonly bucketName: string
    private readonly basePrefix: string

    public constructor(client: S3Client, bucketName: string, basePrefix: string)
    {
        this.client = client
        this.bucketName = bucketName
        this.basePrefix = basePrefix
    }

    public CreateStorage(location: string): IStorage
    {
        const existing = this.stores.get(location)
        if (existing !== undefined)
        {
            return existing
        }
        const prefix = this.PrefixFor(location)
        const created = new S3ObjectStore(
            new RealS3Bucket(this.client, this.bucketName, prefix),
            this.RootDescriptor(prefix))
        this.stores.set(location, created)
        return created
    }

    private PrefixFor(location: string): string
    {
        const sep = S3StorageProviderRegistry.Separator
        const parts = [this.basePrefix, location].join(sep).split(sep).filter(p => p.length > 0)
        return parts.length === 0 ? '' : parts.join(sep) + sep
    }

    private RootDescriptor(prefix: string): string
    {
        return S3StorageProviderRegistry.RootScheme + this.bucketName + S3StorageProviderRegistry.Separator + prefix
    }
}
