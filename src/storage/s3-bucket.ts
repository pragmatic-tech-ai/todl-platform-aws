/** The narrow subset of a cloud object bucket the S3 object store needs. Injected so the store is
 *  unit-testable against a fake and integration-tested against LocalStack/MinIO. Keys are full object
 *  names (already prefixed); byte payloads are raw. */
export interface IS3Bucket
{
    Save(key: string, bytes: Uint8Array): Promise<void>
    Download(key: string): Promise<Uint8Array | undefined>
    Delete(key: string): Promise<void>
    ListKeys(): Promise<readonly string[]>
}
