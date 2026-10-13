import type { IS3Bucket } from '../storage/s3-bucket.js'

/** In-memory IS3Bucket for deterministic tests. Stores raw bytes; carries no prefix/directory logic
 *  (that lives in S3ObjectStore). */
export class FakeS3Bucket implements IS3Bucket
{
    private readonly objects = new Map<string, Uint8Array>()

    public Save(key: string, bytes: Uint8Array): Promise<void>
    {
        this.objects.set(key, Uint8Array.from(bytes))
        return Promise.resolve()
    }

    public Download(key: string): Promise<Uint8Array | undefined>
    {
        const value = this.objects.get(key)
        return Promise.resolve(value === undefined ? undefined : Uint8Array.from(value))
    }

    public Delete(key: string): Promise<void>
    {
        this.objects.delete(key)
        return Promise.resolve()
    }

    public ListKeys(): Promise<readonly string[]>
    {
        return Promise.resolve([...this.objects.keys()])
    }
}
