import { S3Client } from '@aws-sdk/client-s3'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import type { ISqlSession, IStorageProviderRegistry } from '@pragmatic-tech-ai/todl'
import type { ISecretStore } from '@pragmatic-tech-ai/todl-identity'
import { PgSession } from '@pragmatic-tech-ai/todl-platform-cloud'
import { AwsSecretsManagerSecretStore } from '../secrets/aws-secrets-manager-secret-store.js'
import { RealSecretsManagerClient } from '../secrets/real-secrets-manager-client.js'
import { RdsAuthMode, RdsPoolFactory } from '../sql/rds-pool-factory.js'
import type { IRdsPoolHandle } from '../sql/rds-pool-factory.js'
import { S3StorageProviderRegistry } from '../storage/s3-storage-provider-registry.js'

export interface IAwsCloudBackendsConfig
{
    s3Bucket: string
    s3Prefix?: string
    awsRegion: string
    rdsHost: string
    rdsPort?: number
    rdsUser: string
    rdsDatabase: string
    rdsAuth?: string
    rdsPasswordRef?: string
}

/** Injectable SDK/pool construction (defaults build the real clients). */
export interface IAwsCloudBackendsFactories
{
    CreateS3Client(region: string): S3Client
    CreateSecretsManagerClient(region: string): SecretsManagerClient
    CreatePool(config: IAwsCloudBackendsConfig, password?: string): Promise<IRdsPoolHandle>
}

/** S3 storage + Secrets Manager + RDS session, assembled from config. Owns the pool lifecycle. */
export class AwsCloudBackends
{
    private static readonly DefaultRdsPort = 5432
    private static readonly MissingRdsPasswordRef = 'RDS password authentication requires a password secret reference'
    private static readonly RdsPasswordAbsent = 'RDS password secret could not be resolved'
    private static readonly InvalidRdsAuth = 'Invalid rdsAuth'

    private static readonly DefaultFactories: IAwsCloudBackendsFactories = {
        CreateS3Client: region => new S3Client({ region }),
        CreateSecretsManagerClient: region => new SecretsManagerClient({ region }),
        CreatePool: (config, password) => new RdsPoolFactory({
            host: config.rdsHost,
            port: config.rdsPort ?? AwsCloudBackends.DefaultRdsPort,
            user: config.rdsUser,
            database: config.rdsDatabase,
            authMode: AwsCloudBackends.ParseAuth(config.rdsAuth),
            password,
            region: config.awsRegion
        }).Create()
    }

    private constructor(
        public readonly Storage: IStorageProviderRegistry,
        public readonly SecretManager: ISecretStore,
        public readonly Session: ISqlSession,
        private readonly sql: IRdsPoolHandle)
    {
    }

    public static async Create(
        config: IAwsCloudBackendsConfig,
        factories: IAwsCloudBackendsFactories = AwsCloudBackends.DefaultFactories): Promise<AwsCloudBackends>
    {
        const storage = new S3StorageProviderRegistry(
            factories.CreateS3Client(config.awsRegion), config.s3Bucket, config.s3Prefix ?? '')
        const secretManager = new AwsSecretsManagerSecretStore(
            new RealSecretsManagerClient(factories.CreateSecretsManagerClient(config.awsRegion)))
        let password: string | undefined
        if (AwsCloudBackends.ParseAuth(config.rdsAuth) === RdsAuthMode.Password)
        {
            const ref = config.rdsPasswordRef
            if (ref === undefined)
            {
                throw new Error(AwsCloudBackends.MissingRdsPasswordRef)
            }
            const resolved = await secretManager.Get(ref)
            if (resolved === null)
            {
                throw new Error(AwsCloudBackends.RdsPasswordAbsent)
            }
            password = resolved
        }
        const sql = await factories.CreatePool(config, password)
        return new AwsCloudBackends(storage, secretManager, new PgSession(sql.Pool), sql)
    }

    /** Ends the pool, once. Deliberately does NOT also call Session.Dispose()
     *  (PgSession.Dispose also ends the pool: calling both would double-close it). */
    public async Dispose(): Promise<void>
    {
        await this.sql.Dispose()
    }

    private static ParseAuth(value: string | undefined): RdsAuthMode | undefined
    {
        if (value === undefined)
        {
            return undefined
        }
        const found = Object.values(RdsAuthMode).find(v => v === value.toLowerCase())
        if (found === undefined)
        {
            throw new Error(AwsCloudBackends.InvalidRdsAuth)
        }
        return found
    }
}
