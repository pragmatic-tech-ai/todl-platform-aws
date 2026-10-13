import type { IStorage, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { IS3Bucket } from './s3-bucket.js'

/** S3-backed object store over an injectable IS3Bucket seam. Reproduces InMemoryObjectStore semantics:
 *  directories are derived from key prefixes; explicit empty directories are zero-byte marker objects at
 *  `<dir>/`. Text is utf-8, bytes are raw. Rename is copy-then-delete (non-atomic). Implements IStorage
 *  ONLY (no Stat/Watch/local-file companions), so the runtime capability guards report false. */
export class S3ObjectStore implements IStorage
{
    private static readonly NotFoundPrefix = 'ENOENT: '
    private static readonly RootWriteMessage = 'cannot write an object at the storage root'
    private static readonly Separator = '/'
    private static readonly PathSplitter = /[\\/]/

    public readonly Root: string
    private readonly bucket: IS3Bucket

    public constructor(bucket: IS3Bucket, root: string)
    {
        this.bucket = bucket
        this.Root = root
    }

    public async ReadText(path: string): Promise<string>
    {
        return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await this.Require(path))
    }

    public ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.Require(path)
    }

    public async WriteText(path: string, content: string): Promise<void>
    {
        await this.bucket.Save(S3ObjectStore.WritableKey(path), new TextEncoder().encode(content))
    }

    public async WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        await this.bucket.Save(S3ObjectStore.WritableKey(path), bytes)
    }

    public async Exists(path: string): Promise<boolean>
    {
        const key = S3ObjectStore.Normalize(path)
        if (key === '')
        {
            return true
        }
        if ((await this.bucket.Download(key)) !== undefined)
        {
            return true
        }
        const prefix = key + S3ObjectStore.Separator
        const keys = await this.bucket.ListKeys()
        return keys.some(k => k.startsWith(prefix))
    }

    public async Delete(path: string): Promise<void>
    {
        const key = S3ObjectStore.Normalize(path)
        const prefix = key + S3ObjectStore.Separator
        const keys = await this.bucket.ListKeys()
        for (const k of keys)
        {
            if (k === key || k.startsWith(prefix))
            {
                await this.bucket.Delete(k)
            }
        }
    }

    public async CreateDirectory(path: string): Promise<void>
    {
        let key = S3ObjectStore.Normalize(path)
        while (key !== '')
        {
            await this.bucket.Save(key + S3ObjectStore.Separator, new Uint8Array(0))
            key = S3ObjectStore.ParentOf(key)
        }
    }

    public async Rename(from: string, to: string): Promise<void>
    {
        const src = S3ObjectStore.Normalize(from)
        const dst = S3ObjectStore.Normalize(to)
        const keys = await this.bucket.ListKeys()
        const moves: { key: string, next: string, bytes: Uint8Array | undefined }[] = []
        for (const key of keys)
        {
            const isMarker = S3ObjectStore.IsMarker(key)
            const name = isMarker ? S3ObjectStore.StripMarker(key) : key
            const rewritten = S3ObjectStore.Rewrite(name, src, dst)
            if (rewritten === undefined)
            {
                continue
            }
            if (rewritten === '' && !isMarker)
            {
                throw new Error(S3ObjectStore.RootWriteMessage)
            }
            const next = isMarker ? (rewritten === '' ? '' : rewritten + S3ObjectStore.Separator) : rewritten
            moves.push({ key, next, bytes: await this.bucket.Download(key) })
        }
        for (const move of moves)
        {
            await this.bucket.Delete(move.key)
        }
        for (const move of moves)
        {
            if (move.bytes !== undefined && move.next !== '')
            {
                await this.bucket.Save(move.next, move.bytes)
            }
        }
    }

    public async List(path: string): Promise<readonly StorageEntry[]>
    {
        const dir = S3ObjectStore.Normalize(path)
        const prefix = dir === '' ? '' : dir + S3ObjectStore.Separator
        const children = new Map<string, boolean>()
        for (const key of await this.bucket.ListKeys())
        {
            if (S3ObjectStore.IsMarker(key))
            {
                S3ObjectStore.CollectChild(children, S3ObjectStore.StripMarker(key), prefix, true)
            }
            else
            {
                S3ObjectStore.CollectChild(children, key, prefix, false)
            }
        }
        return [...children].map(([Name, IsDirectory]) => ({ Name, IsDirectory }))
    }

    private async Require(path: string): Promise<Uint8Array>
    {
        const key = S3ObjectStore.Normalize(path)
        const bytes = await this.bucket.Download(key)
        if (bytes === undefined)
        {
            throw new Error(`${S3ObjectStore.NotFoundPrefix}${key}`)
        }
        return bytes
    }

    private static WritableKey(path: string): string
    {
        const key = S3ObjectStore.Normalize(path)
        if (key === '')
        {
            throw new Error(S3ObjectStore.RootWriteMessage)
        }
        return key
    }

    private static IsMarker(key: string): boolean
    {
        return key.endsWith(S3ObjectStore.Separator)
    }

    private static StripMarker(key: string): string
    {
        return S3ObjectStore.Normalize(key)
    }

    private static CollectChild(children: Map<string, boolean>, key: string, prefix: string, forceDirectory: boolean): void
    {
        if (!key.startsWith(prefix))
        {
            return
        }
        const rest = key.slice(prefix.length)
        if (rest === '')
        {
            return
        }
        const slash = rest.indexOf(S3ObjectStore.Separator)
        if (slash === -1)
        {
            children.set(rest, forceDirectory || (children.get(rest) ?? false))
        }
        else
        {
            children.set(rest.slice(0, slash), true)
        }
    }

    private static Rewrite(key: string, src: string, dst: string): string | undefined
    {
        if (key === src)
        {
            return dst
        }
        if (key.startsWith(src + S3ObjectStore.Separator))
        {
            return S3ObjectStore.Normalize(dst + key.slice(src.length))
        }
        return undefined
    }

    private static Normalize(path: string): string
    {
        return path.split(S3ObjectStore.PathSplitter).filter(s => s.length > 0).join(S3ObjectStore.Separator)
    }

    private static ParentOf(key: string): string
    {
        const slash = key.lastIndexOf(S3ObjectStore.Separator)
        return slash === -1 ? '' : key.slice(0, slash)
    }
}
