import { S3Client } from '@aws-sdk/client-s3'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import type { IAwsCloudBackendsConfig, IAwsCloudBackendsFactories } from '../platform/aws-cloud-backends.js'
import type { IRdsPoolHandle } from '../sql/rds-pool-factory.js'

export interface IAwsEmulatorOptions
{
    /** S3 emulator base URL, e.g. http://localhost:9000 */
    s3Endpoint: string
    /** Secrets Manager emulator base URL */
    secretsEndpoint: string
    region: string
    /** supplies the SQL pool (there is no RDS emulator; tests pass a plain local pg pool) */
    CreatePool(config: IAwsCloudBackendsConfig, password?: string): Promise<IRdsPoolHandle>
}

/** Test helper: AwsCloudBackends factories that point the real SDK clients at local emulators, so
 *  consumers can exercise the real backend wiring without importing the @aws-sdk clients themselves. */
export class AwsEmulatorFactories
{
    private static readonly DummyKey = 'test'
    private static readonly DummySecret = 'test'

    public static ForTest(options: IAwsEmulatorOptions): IAwsCloudBackendsFactories
    {
        return {
            CreateS3Client: () => new S3Client({
                endpoint: options.s3Endpoint,
                forcePathStyle: true,
                region: options.region,
                credentials: { accessKeyId: AwsEmulatorFactories.DummyKey, secretAccessKey: AwsEmulatorFactories.DummySecret }
            }),
            CreateSecretsManagerClient: () => new SecretsManagerClient({
                endpoint: options.secretsEndpoint,
                region: options.region,
                credentials: { accessKeyId: AwsEmulatorFactories.DummyKey, secretAccessKey: AwsEmulatorFactories.DummySecret }
            }),
            CreatePool: (config, password) => options.CreatePool(config, password)
        }
    }
}
