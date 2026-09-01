/**
 * Read individual members out of a remote ZIP without downloading it.
 *
 * Several corpora ship as one multi-gigabyte archive of which we want a few
 * megabytes: Dagstuhl ChoirSet is 5.1 GB and its beat annotations are ~23 KB;
 * JaCRC's recordings zip is 7.1 GB and the student subset is a fraction of it.
 * A zip's central directory lives at the END of the file, so one ranged GET of
 * the tail lists every member and its byte offset, after which each wanted
 * member is a second ranged GET. This is the technique
 * `research/research-voice-datasets.md` §0 calls "read the archive without downloading
 * it", generalised so fetchers do not each re-implement it.
 *
 * ZIP64 is handled: archives >4 GB (or >65535 members) store 0xFFFFFFFF
 * placeholders in the classic EOCD and keep the real sizes/offsets in a ZIP64
 * EOCD record, plus per-member ZIP64 extra fields. Both are parsed.
 *
 * Requires the server to honour `Range`. Zenodo does (HTTP 206).
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { inflateRawSync } from 'zlib';

export interface ZipEntry {
  /** Full path inside the archive. */
  name: string;
  /** Uncompressed size in bytes. */
  usize: number;
  /** Compressed size in bytes. */
  csize: number;
  /** Offset of this member's local file header within the archive. */
  lho: number;
  /** Compression method: 0 = stored, 8 = deflate. */
  method: number;
}

/** How much of the archive's tail to pull when looking for the directory. */
const TAIL_BYTES = 3_000_000;

function curlRange(url: string, start: number, end: number, dest: string): void {
  execFileSync(
    'curl',
    ['-s', '--fail', '--max-time', '900', '-r', `${start}-${end}`, '-o', dest, url],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

/** Total archive size, from a HEAD that follows redirects. */
export function remoteSize(url: string): number {
  const out = execFileSync('curl', ['-sIL', url], { encoding: 'utf8' });
  // Redirect chains repeat the header; the LAST one describes the real body.
  const lengths = [...out.matchAll(/content-length:\s*(\d+)/gi)].map((m) => Number(m[1]));
  if (!lengths.length) throw new Error(`no Content-Length for ${url}`);
  return lengths[lengths.length - 1];
}

/**
 * Fetch and parse the archive's central directory. The tail read is cached
 * under `cacheDir` so re-runs cost nothing.
 */
export function readCentralDirectory(url: string, cacheDir: string): ZipEntry[] {
  mkdirSync(cacheDir, { recursive: true });
  const cdPath = join(cacheDir, 'central-directory.bin');
  const total = remoteSize(url);
  const tailStart = Math.max(0, total - TAIL_BYTES);
  if (!existsSync(cdPath)) curlRange(url, tailStart, total - 1, cdPath);
  const buf = readFileSync(cdPath);

  let cdSize: number;
  let cdOff: number;
  const locIdx = buf.lastIndexOf(Buffer.from('PK\x06\x07', 'latin1'));
  if (locIdx >= 0) {
    // ZIP64: the locator points at the ZIP64 EOCD record holding the real values.
    const z = Number(buf.readBigUInt64LE(locIdx + 8)) - tailStart;
    if (buf.toString('latin1', z, z + 4) !== 'PK\x06\x06') {
      throw new Error('ZIP64 EOCD record is not where the locator points');
    }
    cdSize = Number(buf.readBigUInt64LE(z + 40));
    cdOff = Number(buf.readBigUInt64LE(z + 48));
  } else {
    const e = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (e < 0) throw new Error('no end-of-central-directory record found');
    cdSize = buf.readUInt32LE(e + 12);
    cdOff = buf.readUInt32LE(e + 16);
  }

  if (cdOff < tailStart) {
    // Buffer.subarray treats a negative start as counting from the END, so an
    // out-of-window directory would silently parse as zero entries instead of
    // failing — and a fetcher would then "select 0 stems" with no hint why.
    throw new Error(
      `central directory starts at ${cdOff}, before the fetched tail window ` +
        `(${tailStart}); raise TAIL_BYTES above ${TAIL_BYTES}`,
    );
  }
  const cd = buf.subarray(cdOff - tailStart, cdOff - tailStart + cdSize);
  const entries: ZipEntry[] = [];
  let pos = 0;
  while (pos + 46 <= cd.length && cd.toString('latin1', pos, pos + 4) === 'PK\x01\x02') {
    const method = cd.readUInt16LE(pos + 10);
    let csize = cd.readUInt32LE(pos + 20);
    let usize = cd.readUInt32LE(pos + 24);
    const nlen = cd.readUInt16LE(pos + 28);
    const elen = cd.readUInt16LE(pos + 30);
    const clen = cd.readUInt16LE(pos + 32);
    let lho = cd.readUInt32LE(pos + 42);
    const name = cd.toString('utf8', pos + 46, pos + 46 + nlen);
    // The ZIP64 extra field supplies only the fields that were maxed out, in
    // this fixed order — read them in the same order, skipping the rest.
    if (usize === 0xffffffff || csize === 0xffffffff || lho === 0xffffffff) {
      const extra = cd.subarray(pos + 46 + nlen, pos + 46 + nlen + elen);
      let ep = 0;
      while (ep + 4 <= extra.length) {
        const hid = extra.readUInt16LE(ep);
        const hsz = extra.readUInt16LE(ep + 2);
        if (hid === 0x0001) {
          let vi = ep + 4;
          if (usize === 0xffffffff) { usize = Number(extra.readBigUInt64LE(vi)); vi += 8; }
          if (csize === 0xffffffff) { csize = Number(extra.readBigUInt64LE(vi)); vi += 8; }
          if (lho === 0xffffffff) lho = Number(extra.readBigUInt64LE(vi));
          break;
        }
        ep += 4 + hsz;
      }
    }
    entries.push({ name, usize, csize, lho, method });
    pos += 46 + nlen + elen + clen;
  }
  return entries;
}

/**
 * Fetch one member by ranged GET and inflate it, caching the result.
 *
 * The local file header's name/extra lengths are read from the header itself
 * rather than reused from the central directory: the spec does not require the
 * two to agree, and some writers pad the local extra field differently. The
 * header's `csize` is NOT trusted — writers that stream output leave it zero
 * and put the real value in a trailing data descriptor — so the central
 * directory's `csize` is used to bound the read.
 */
export function readZipEntry(url: string, e: ZipEntry, cacheDir: string): Buffer {
  const cached = join(cacheDir, 'entries', e.name.replace(/[/\\]/g, '__'));
  if (existsSync(cached)) return readFileSync(cached);
  mkdirSync(join(cacheDir, 'entries'), { recursive: true });

  const headPath = join(cacheDir, '.lfh.bin');
  curlRange(url, e.lho, e.lho + 29, headPath);
  const lfh = readFileSync(headPath);
  if (lfh.toString('latin1', 0, 4) !== 'PK\x03\x04') {
    throw new Error(`bad local file header for ${e.name}`);
  }
  const dataStart = e.lho + 30 + lfh.readUInt16LE(26) + lfh.readUInt16LE(28);

  const rawPath = join(cacheDir, '.entry.raw');
  curlRange(url, dataStart, dataStart + e.csize - 1, rawPath);
  const comp = readFileSync(rawPath);
  const out = e.method === 8 ? inflateRawSync(comp) : comp;
  if (out.length !== e.usize) {
    throw new Error(`size mismatch for ${e.name}: got ${out.length}, expected ${e.usize}`);
  }
  writeFileSync(cached, out);
  return out;
}
