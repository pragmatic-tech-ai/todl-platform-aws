import { randomBytes } from 'node:crypto'
import { S3Client } from '@aws-sdk/client-s3'
import { S3ObjectStore } from '../s3-object-store.js'
import { RealS3Bucket } from '../real-s3-bucket.js'
import { IStorageConformance } from '../../testing/istorage-conformance.js'

/** Gated: runs the shared IStorage conformance suite against the real SDK + RealS3Bucket pointed at an S3
 *  emulator (LocalStack/MinIO). Skips unless PRAGMATIC_TEST_S3_ENDPOINT and PRAGMATIC_TEST_S3_BUCKET are set. */
class LiveS3Conformance
{
    private static readonly EndpointVar = 'PRAGMATIC_TEST_S3_ENDPOINT'
    private static readonly BucketVar = 'PRAGMATIC_TEST_S3_BUCKET'
    private static readonly RegionVar = 'PRAGMATIC_TEST_S3_REGION'
    private static readonly DefaultRegion = 'us-east-1'
    private static readonly EmulatorCredential = 'test'
    private static readonly Descriptor = 'object://bucket'
    private static readonly RunPrefix = 'run-'
    private static readonly Separator = '/'
    private static readonly SkipReason = 'set PRAGMATIC_TEST_S3_ENDPOINT and PRAGMATIC_TEST_S3_BUCKET to run'

    private readonly endpoint: string | undefined = process.env[LiveS3Conformance.EndpointVar]
    private readonly bucketName: string | undefined = process.env[LiveS3Conformance.BucketVar]
    private readonly prefixes: string[] = []
    private client: S3Client | undefined

    public Register(): void
    {
        const enabled = this.endpoint !== undefined && this.bucketName !== undefined
        IStorageConformance.Run(() => this.MakeStore(), {
            AssertCapabilityOmission: true,
            ExpectedRoot: LiveS3Conformance.Descriptor,
            Skip: enabled ? false : LiveS3Conformance.SkipReason,
            Cleanup: () => this.CleanUp()
        })
    }

    private MakeStore(): S3ObjectStore
    {
        this.client ??= new S3Client({
            endpoint: this.endpoint,
            forcePathStyle: true,
            region: process.env[LiveS3Conformance.RegionVar] ?? LiveS3Conformance.DefaultRegion,
            credentials: { accessKeyId: LiveS3Conformance.EmulatorCredential, secretAccessKey: LiveS3Conformance.EmulatorCredential }
        })
        const prefix = LiveS3Conformance.RunPrefix + randomBytes(8).toString('hex') + LiveS3Conformance.Separator
        this.prefixes.push(prefix)
        return new S3ObjectStore(new RealS3Bucket(this.client, this.bucketName as string, prefix), LiveS3Conformance.Descriptor)
    }

    private async CleanUp(): Promise<void>
    {
        const client = this.client
        const prefixes = this.prefixes.splice(0)
        if (client === undefined)
        {
            return
        }
        for (const prefix of prefixes)
        {
            const bucket = new RealS3Bucket(client, this.bucketName as string, prefix)
            for (const key of await bucket.ListKeys())
            {
                await bucket.Delete(key)
            }
        }
    }
}

new LiveS3Conformance().Register()
