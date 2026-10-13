import { Signer } from '@aws-sdk/rds-signer'
import pg from 'pg'

export enum RdsAuthMode
{
    Iam = 'iam',
    Password = 'password'
}

/** The slice of @aws-sdk/rds-signer's Signer this factory uses (injectable for tests). */
export interface IRdsSigner
{
    getAuthToken(): Promise<string>
}

/** The slice of pg.Pool this factory needs to tear down. */
export interface IRdsPool
{
    end(): Promise<void>
}

export interface IRdsPoolOptions
{
    host: string
    port: number
    user: string
    database: string
    authMode?: RdsAuthMode
    /** Already-resolved password; only meaningful with PASSWORD auth. This factory never reads a secret. */
    password?: string
    region?: string
}

export interface IRdsPoolHandle
{
    Pool: pg.Pool
    Dispose(): Promise<void>
}

/** Builds a pg.Pool over Amazon RDS/Aurora Postgres. IAM mode passes pg a password FUNCTION that mints a
 *  fresh IAM auth token per connection (never cached, never logged). TLS is required in both modes. */
export class RdsPoolFactory
{
    private static readonly MaxConnections = 10
    private static readonly DefaultAuthMode = RdsAuthMode.Iam

    public constructor(
        private readonly options: IRdsPoolOptions,
        private readonly createSigner: (o: IRdsPoolOptions) => IRdsSigner = o =>
            new Signer({ hostname: o.host, port: o.port, username: o.user, region: o.region }) as unknown as IRdsSigner,
        private readonly createPool: (cfg: Record<string, unknown>) => IRdsPool = cfg => new pg.Pool(cfg))
    {
    }

    public async Create(): Promise<IRdsPoolHandle>
    {
        const authMode = this.options.authMode ?? RdsAuthMode.Iam
        const cfg: Record<string, unknown> = {
            host: this.options.host,
            port: this.options.port,
            user: this.options.user,
            database: this.options.database,
            max: RdsPoolFactory.MaxConnections,
            ssl: { rejectUnauthorized: true }
        }
        if (authMode === RdsAuthMode.Iam)
        {
            cfg.password = async () => this.createSigner(this.options).getAuthToken()
        }
        else if (this.options.password !== undefined)
        {
            cfg.password = this.options.password
        }
        const pool = this.createPool(cfg)
        return {
            Pool: pool as pg.Pool,
            Dispose: async () =>
            {
                await pool.end()
            }
        }
    }
}
