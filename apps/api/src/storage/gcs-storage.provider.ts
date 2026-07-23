import { Bucket, Storage } from '@google-cloud/storage';
import type { Readable, Writable } from 'stream';

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

  createReadStream(key: string): Readable {
    return this.bucket.file(key).createReadStream();
  }

  async list(prefix: string): Promise<string[]> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((file) => file.name);
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string | null> {
    // V4 signing under workload identity goes through the IAM signBlob API —
    // the service account needs roles/iam.serviceAccountTokenCreator on
    // itself. Callers treat a signing failure as "stream it instead".
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
    });
    return url;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.bucket.deleteFiles({ prefix });
  }
}
