import type { S3Client } from '@aws-sdk/client-s3'
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import type { IS3Bucket } from './s3-bucket.js'

/** Thin @aws-sdk/client-s3 wrapper behind IS3Bucket. The prefix is prepended on the way in and stripped on
 *  the way out so S3ObjectStore only ever sees location-relative keys. Logs nothing. */
export class RealS3Bucket implements IS3Bucket
{
    private static readonly NoSuchKeyName = 'NoSuchKey'
    private static readonly NotFoundName = 'NotFound'
    private static readonly NotFoundStatus = 404

    private readonly client: S3Client
    private readonly bucket: string
    private readonly prefix: string

    public constructor(client: S3Client, bucket: string, prefix: string)
    {
        this.client = client
        this.bucket = bucket
        this.prefix = prefix
    }

    public async Save(key: string, bytes: Uint8Array): Promise<void>
    {
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.prefix + key, Body: Buffer.from(bytes) }))
    }

    public async Download(key: string): Promise<Uint8Array | undefined>
    {
        try
        {
            const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.prefix + key }))
            const body = await response.Body?.transformToByteArray()
            return body === undefined ? undefined : new Uint8Array(body)
        }
        catch (e)
        {
            if (RealS3Bucket.IsNotFound(e))
            {
                return undefined
            }
            throw e
        }
    }

    public async Delete(key: string): Promise<void>
    {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.prefix + key }))
    }

    public async ListKeys(): Promise<string[]>
    {
        const keys: string[] = []
        let token: string | undefined
        do
        {
            const response = await this.client.send(
                new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, ContinuationToken: token }))
            for (const item of response.Contents ?? [])
            {
                if (item.Key !== undefined)
                {
                    keys.push(item.Key.slice(this.prefix.length))
                }
            }
            token = response.IsTruncated ? response.NextContinuationToken : undefined
        }
        while (token !== undefined)
        return keys
    }

    private static IsNotFound(e: unknown): boolean
    {
        const err = e as { name?: string, $metadata?: { httpStatusCode?: number } }
        return err.name === RealS3Bucket.NoSuchKeyName
            || err.name === RealS3Bucket.NotFoundName
            || err.$metadata?.httpStatusCode === RealS3Bucket.NotFoundStatus
    }
}
