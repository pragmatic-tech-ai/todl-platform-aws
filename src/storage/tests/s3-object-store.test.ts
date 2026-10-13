import { S3ObjectStore } from '../s3-object-store.js'
import { FakeS3Bucket } from '../../testing/fake-s3-bucket.js'
import { IStorageConformance } from '../../testing/istorage-conformance.js'

class FakeS3Conformance
{
    private static readonly Descriptor = 'object://bucket'

    public static Register(): void
    {
        IStorageConformance.Run(() => new S3ObjectStore(new FakeS3Bucket(), FakeS3Conformance.Descriptor), {
            AssertCapabilityOmission: true,
            ExpectedRoot: FakeS3Conformance.Descriptor,
            Skip: false
        })
    }
}

FakeS3Conformance.Register()
