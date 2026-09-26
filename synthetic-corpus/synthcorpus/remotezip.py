"""Read members of a remote zip over HTTP range requests (no full download)."""

from __future__ import annotations

import io
import urllib.request
import zipfile


class HttpRangeFile(io.RawIOBase):
    def __init__(self, url: str, block: int = 1 << 20):
        self.url = url
        self.pos = 0
        self.block = block
        self._cache: dict[int, bytes] = {}
        req = urllib.request.Request(url, method='HEAD')
        with urllib.request.urlopen(req) as r:
            self.url = r.geturl()
            self.size = int(r.headers['Content-Length'])

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def _fetch(self, start: int, end: int) -> bytes:
        req = urllib.request.Request(self.url, headers={'Range': f'bytes={start}-{end - 1}'})
        with urllib.request.urlopen(req) as r:
            return r.read()

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b''
        if n > self.block:
            data = self._fetch(self.pos, self.pos + n)
        else:
            b0 = self.pos // self.block
            b1 = (self.pos + n - 1) // self.block
            chunks = []
            for b in range(b0, b1 + 1):
                if b not in self._cache:
                    if len(self._cache) > 64:
                        self._cache.clear()
                    self._cache[b] = self._fetch(b * self.block, min(self.size, (b + 1) * self.block))
                chunks.append(self._cache[b])
            buf = b''.join(chunks)
            off = self.pos - b0 * self.block
            data = buf[off : off + n]
        self.pos += len(data)
        return data

    def readinto(self, b) -> int:
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def open_remote_zip(url: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BufferedReader(HttpRangeFile(url), buffer_size=1 << 16))
