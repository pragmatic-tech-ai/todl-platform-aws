import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { isStatStorage, isWatchableStorage, isLocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'

/** Options for a conformance run. */
export interface IStorageConformanceOptions
{
    /** Assert the store omits IStatStorage / IWatchableStorage / ILocalFileAccess. */
    readonly AssertCapabilityOmission: boolean
    /** The Root the store must report; omitted skips the Root check. */
    readonly ExpectedRoot?: string
    /** node:test skip reason, or false to run. */
    readonly Skip: string | false
    /** Called after every case (pass or fail) to release state created by that case's store. */
    readonly Cleanup?: () => Promise<void>
}

/** The single IStorage behaviour-parity assertion set. `make` is invoked once per case so each case gets
 *  isolated state (fresh store / unique key prefix). */
export class IStorageConformance
{
    private static readonly Utf8Text = 'héllo — 世界'
    private static readonly Bom = '﻿'
    private static readonly AllBytes = [0, 1, 127, 128, 200, 255]
    private static readonly CapabilityCaseName = 'it omits the filesystem-only companion capabilities'

    private static FormatEntry(e: { Name: string, IsDirectory: boolean }): string
    {
        return `${e.Name}:${e.IsDirectory}`
    }

    public static Run(make: () => IStorage, options: IStorageConformanceOptions): void
    {
        const cases: Array<[string, (store: IStorage) => Promise<void>]> = [
            ['text round-trips and Root is the given descriptor', s => IStorageConformance.TextRoundTrip(s, options.ExpectedRoot)],
            ['bytes round-trip losslessly for all byte values', s => IStorageConformance.BytesRoundTrip(s)],
            ['reading a missing object rejects', s => IStorageConformance.MissingRejects(s)],
            ['Exists is true for a stored object, a prefix directory, and an explicit empty directory; false otherwise', s => IStorageConformance.ExistsKinds(s)],
            ['List is non-recursive and prefix-scoped; a missing directory lists empty', s => IStorageConformance.ListNonRecursive(s)],
            ['Delete removes a whole subtree', s => IStorageConformance.DeleteSubtree(s)],
            ['Rename moves a single object', s => IStorageConformance.RenameSingle(s)],
            ['Rename re-keys an entire folder subtree and nothing outside it', s => IStorageConformance.RenameSubtree(s)],
            ['Exists is true for the root even when empty (parity with the real backend)', s => IStorageConformance.RootExists(s)],
            ['renaming a folder to the root yields normalized top-level keys (no leading slash)', s => IStorageConformance.RenameFolderToRoot(s)],
            ['missing reads reject with an ENOENT-prefixed error', s => IStorageConformance.MissingEnoent(s)],
            ['non-ASCII text round-trips losslessly (utf-8)', s => IStorageConformance.NonAscii(s)],
            ['a leading BOM is preserved on text round-trip', s => IStorageConformance.BomPreserved(s)],
            ['writing at the root key throws', s => IStorageConformance.WriteRootThrows(s)],
            ['renaming a file to the root throws and does not lose the file', s => IStorageConformance.RenameFileToRootThrows(s)],
            ['renaming a folder with a marker to the root drops the marker and keeps files', s => IStorageConformance.RenameMarkedFolderToRoot(s)],
            ['renaming into its own subtree works from a snapshot', s => IStorageConformance.RenameIntoOwnSubtree(s)],
            ['directory markers are directories, never file entries', s => IStorageConformance.DirectoryMarkers(s)]
        ]
        if (options.AssertCapabilityOmission)
        {
            cases.push([IStorageConformance.CapabilityCaseName, s => IStorageConformance.CapabilityOmission(s)])
        }
        for (const [name, body] of cases)
        {
            test(name, { skip: options.Skip }, async () =>
            {
                let bodyError: unknown
                try
                {
                    await body(make())
                }
                catch (error)
                {
                    bodyError = error
                }
                if (options.Cleanup !== undefined)
                {
                    try
                    {
                        await options.Cleanup()
                    }
                    catch (cleanupError)
                    {
                        // Never let a cleanup failure mask a real assertion error; surface it only on a clean body.
                        if (bodyError === undefined)
                        {
                            bodyError = cleanupError
                        }
                    }
                }
                if (bodyError !== undefined)
                {
                    throw bodyError
                }
            })
        }
    }

    private static CapabilityOmission(store: IStorage): Promise<void>
    {
        assert.equal(isStatStorage(store), false)
        assert.equal(isWatchableStorage(store), false)
        assert.equal(isLocalFileAccess(store), false)
        return Promise.resolve()
    }

    private static async TextRoundTrip(store: IStorage, expectedRoot: string | undefined): Promise<void>
    {
        if (expectedRoot !== undefined)
        {
            assert.equal(store.Root, expectedRoot)
        }
        await store.WriteText('a/b.txt', 'hello')
        assert.equal(await store.ReadText('a/b.txt'), 'hello')
    }

    private static async BytesRoundTrip(store: IStorage): Promise<void>
    {
        const bytes = Uint8Array.from(IStorageConformance.AllBytes)
        await store.WriteBytes('blob.bin', bytes)
        assert.deepEqual([...(await store.ReadBytes('blob.bin'))], [...bytes])
    }

    private static async MissingRejects(store: IStorage): Promise<void>
    {
        await assert.rejects(() => store.ReadText('missing'))
    }

    private static async ExistsKinds(store: IStorage): Promise<void>
    {
        await store.WriteText('dir/file.txt', 'x')
        await store.CreateDirectory('empty')
        assert.equal(await store.Exists('dir/file.txt'), true)
        assert.equal(await store.Exists('dir'), true)
        assert.equal(await store.Exists('empty'), true)
        assert.equal(await store.Exists('nope'), false)
    }

    private static async ListNonRecursive(store: IStorage): Promise<void>
    {
        await store.WriteText('top.txt', 'x')
        await store.WriteText('sub/inner.txt', 'y')
        const root = await store.List('')
        assert.deepEqual([...root].map(e => IStorageConformance.FormatEntry(e)).sort(), ['sub:true', 'top.txt:false'])
        assert.deepEqual(await store.List('does/not/exist'), [])
    }

    private static async DeleteSubtree(store: IStorage): Promise<void>
    {
        await store.WriteText('d/a.txt', '1')
        await store.WriteText('d/sub/b.txt', '2')
        await store.Delete('d')
        assert.equal(await store.Exists('d'), false)
        assert.equal(await store.Exists('d/sub/b.txt'), false)
    }

    private static async RenameSingle(store: IStorage): Promise<void>
    {
        await store.WriteText('old.txt', 'v')
        await store.Rename('old.txt', 'new.txt')
        assert.equal(await store.Exists('old.txt'), false)
        assert.equal(await store.ReadText('new.txt'), 'v')
    }

    private static async RenameSubtree(store: IStorage): Promise<void>
    {
        await store.WriteText('from/a.txt', '1')
        await store.WriteText('from/sub/b.txt', '2')
        await store.WriteText('other/c.txt', '3')
        await store.WriteText('fromother/d.txt', '4')
        await store.Rename('from', 'to')
        assert.equal(await store.ReadText('to/a.txt'), '1')
        assert.equal(await store.ReadText('to/sub/b.txt'), '2')
        assert.equal(await store.Exists('from'), false)
        assert.equal(await store.ReadText('other/c.txt'), '3')
        assert.equal(await store.ReadText('fromother/d.txt'), '4')
    }

    private static async RootExists(store: IStorage): Promise<void>
    {
        assert.equal(await store.Exists(''), true)
    }

    private static async RenameFolderToRoot(store: IStorage): Promise<void>
    {
        await store.WriteText('from/a.txt', '1')
        await store.Rename('from', '')
        assert.equal(await store.ReadText('a.txt'), '1')
        assert.deepEqual([...(await store.List(''))].map(e => e.Name), ['a.txt'])
    }

    private static async MissingEnoent(store: IStorage): Promise<void>
    {
        await assert.rejects(() => store.ReadText('a/missing.txt'), /^Error: ENOENT: a\/missing\.txt$/)
        await assert.rejects(() => store.ReadBytes('/a/missing.bin'), /^Error: ENOENT: a\/missing\.bin$/)
    }

    private static async NonAscii(store: IStorage): Promise<void>
    {
        const text = IStorageConformance.Utf8Text
        await store.WriteText('u.txt', text)
        assert.equal(await store.ReadText('u.txt'), text)
        assert.deepEqual([...(await store.ReadBytes('u.txt'))], [...new TextEncoder().encode(text)])
    }

    private static async BomPreserved(store: IStorage): Promise<void>
    {
        const text = IStorageConformance.Bom + 'abc'
        await store.WriteText('f', text)
        assert.equal(await store.ReadText('f'), text)
    }

    private static async WriteRootThrows(store: IStorage): Promise<void>
    {
        await assert.rejects(() => store.WriteText('', 'x'), /root/)
        await assert.rejects(() => store.WriteBytes('/', new Uint8Array(1)), /root/)
    }

    private static async RenameFileToRootThrows(store: IStorage): Promise<void>
    {
        await store.WriteText('f.txt', 'v')
        await assert.rejects(() => store.Rename('f.txt', ''), /root/)
        assert.equal(await store.ReadText('f.txt'), 'v')
    }

    private static async RenameMarkedFolderToRoot(store: IStorage): Promise<void>
    {
        await store.CreateDirectory('from')
        await store.WriteText('from/a.txt', '1')
        await store.Rename('from', '')
        assert.equal(await store.ReadText('a.txt'), '1')
        assert.deepEqual([...(await store.List(''))].map(e => e.Name), ['a.txt'])
    }

    private static async RenameIntoOwnSubtree(store: IStorage): Promise<void>
    {
        await store.WriteText('a', 'A')
        await store.WriteText('a/b', 'B')
        await store.Rename('a', 'a/b')
        assert.equal(await store.ReadText('a/b'), 'A')
        assert.equal(await store.ReadText('a/b/b'), 'B')
    }

    private static async DirectoryMarkers(store: IStorage): Promise<void>
    {
        await store.CreateDirectory('a/b')
        assert.deepEqual([...(await store.List(''))].map(e => IStorageConformance.FormatEntry(e)), ['a:true'])
        assert.deepEqual([...(await store.List('a'))].map(e => IStorageConformance.FormatEntry(e)), ['b:true'])
        assert.equal(await store.Exists('a'), true)
        await store.Rename('a', 'z')
        assert.equal(await store.Exists('a'), false)
        assert.equal(await store.Exists('z/b'), true)
        await store.Delete('z')
        assert.deepEqual(await store.List(''), [])
    }
}
