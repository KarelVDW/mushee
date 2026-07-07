import { Bucket, Storage } from '@google-cloud/storage';
import type { Writable } from 'stream';

import type { StorageProvider } from './storage-provider';

/**
 * Google Cloud Storage backend. Authenticates via Application Default
 * Credentials (GKE workload identity, GOOGLE_APPLICATION_CREDENTIALS, or
 * gcloud auth) — no key material is handled here.
 */
export class GcsStorageProvider implements StorageProvider {
  readonly name: string;
  private readonly bucket: Bucket;

  constructor(bucketName: string, projectId?: string) {
    this.bucket = new Storage(projectId ? { projectId } : {}).bucket(bucketName);
    this.name = `gcs (${bucketName})`;
  }

  async write(key: string, content: string | Buffer): Promise<void> {
    await this.bucket.file(key).save(content, { resumable: false });
  }

  async read(key: string): Promise<string> {
    const [contents] = await this.bucket.file(key).download();
    return contents.toString('utf8');
  }

  createWriteStream(
    key: string,
    options?: { contentType?: string },
  ): Writable {
    // Non-resumable: a recording upload lives exactly as long as its session,
    // so there is nothing to resume, and single-shot uploads stream chunks out
    // as they arrive instead of buffering toward resumable-chunk boundaries.
    return this.bucket.file(key).createWriteStream({
      resumable: false,
      contentType: options?.contentType,
    });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.bucket.deleteFiles({ prefix });
  }
}
