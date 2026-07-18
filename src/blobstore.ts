import { promises as fs } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { config } from "./config";

// ---------------------------------------------------------------------------
// BlobStore — THE new abstraction vs the URL shortener (03_LLD/01_class_design.md).
//
// The paste CONTENT (large, unstructured) lives here; the metadata DB only keeps
// a pointer. PasteService depends on this INTERFACE, so we can run locally with a
// file-based store and deploy with S3/GCS — zero business-logic changes
// (Dependency Inversion). Swap `LocalFileBlobStore` for an `S3BlobStore` and the
// service is none the wiser.
// ---------------------------------------------------------------------------
export interface BlobStore {
  /** Store bytes for `key`; returns the blob_url pointer saved in metadata. */
  put(key: string, data: Buffer): Promise<string>;
  /** Fetch the original (decompressed) bytes, or null if absent. */
  get(key: string): Promise<Buffer | null>;
  /** Remove the object (expiry / burn-after-read / delete). */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// LocalFileBlobStore — dev / self-hosted implementation.
//
// Mirrors what S3 gives us for free:
//   • one object per paste, object key = paste key           (pastes/<key>)
//   • stored gzip-compressed (text compresses ~5-10x)        (storage/bandwidth win)
// In production this class is replaced by an S3BlobStore that PUTs to a bucket
// with Content-Encoding: gzip and lets a CDN serve popular blobs from the edge.
// ---------------------------------------------------------------------------
export class LocalFileBlobStore implements BlobStore {
  constructor(private readonly dir: string = config.blobDir) {}

  private pathFor(key: string): string {
    // `.gz` makes the on-disk compression obvious; the object key is still the paste key.
    return path.join(this.dir, `${key}.gz`);
  }

  async put(key: string, data: Buffer): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    const compressed = gzipSync(data); // compress like we would before a PUT to S3
    await fs.writeFile(this.pathFor(key), compressed);
    // The pointer stored in metadata. Logical form mirrors the S3 layout in the docs.
    return `blob://pastebin-blobs/pastes/${key}`;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const compressed = await fs.readFile(this.pathFor(key));
      return gunzipSync(compressed); // decompress on read
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // already gone — deleting is idempotent
    }
  }
}

// ---------------------------------------------------------------------------
// S3BlobStore — production implementation. This is where Pastebin's headline
// lesson becomes real: the large paste content lives in an S3 bucket (11-nines
// durable, cheap, CDN-frontable), while Postgres keeps only the pointer.
//
// Objects are stored gzip-compressed with `Content-Encoding: gzip` and
// `Content-Type: text/plain`, exactly as 03_LLD/02_schema.md prescribes — so a CDN
// or browser fetching the object directly gets correct headers, while our own get()
// decompresses explicitly. Credentials come from the environment / EC2 instance
// role (IMDS) — no keys in code.
// ---------------------------------------------------------------------------
export class S3BlobStore implements BlobStore {
  private readonly s3: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
    private readonly prefix: string = "pastes",
  ) {
    if (!bucket) throw new Error("S3BlobStore requires S3_BUCKET to be set");
    this.s3 = new S3Client({ region });
  }

  private objectKey(key: string): string {
    return `${this.prefix}/${key}`;
  }

  async put(key: string, data: Buffer): Promise<string> {
    const compressed = gzipSync(data);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: compressed,
        ContentType: "text/plain; charset=utf-8",
        ContentEncoding: "gzip",
      }),
    );
    return `s3://${this.bucket}/${this.objectKey(key)}`;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      const bytes = await res.Body!.transformToByteArray();
      return gunzipSync(Buffer.from(bytes)); // decompress what we compressed on put
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
  }
}

// Single shared instance the app wires into PasteService — chosen by config so the
// same code runs on local disk (dev) or S3 (prod) with zero business-logic changes.
export const blobStore: BlobStore =
  config.blobBackend === "s3"
    ? new S3BlobStore(config.s3Bucket, config.s3Region, config.s3Prefix)
    : new LocalFileBlobStore();
