import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

// =============================================================================
// StorageService — disk-backed photo storage for Wally.
// =============================================================================
//
// Wally is TRIMMED: no S3, no object-store SDK. Photos are written to disk
// under WALLY_STORAGE_DIR (pair it with a Railway Volume in production so
// uploads survive redeploys). Each stored object gets a content-addressable
// storage key; the bytes never leave this process except through a short-lived
// HMAC-signed token (signedGetToken / verifyGetToken) so a photo of a person
// is only ever served to a holder of a valid, unexpired token.
//
// SECURITY: we NEVER log image bytes (CLAUDE.md). Only keys, sizes, and
// outcomes are logged. The signing secret is read from WALLY_STORAGE_SIGNING_KEY
// (falls back to JWT_SECRET so a fresh checkout still boots in dev).
// =============================================================================

const StorageEnv = z
  .object({
    WALLY_STORAGE_DIR: z.string().default('./storage'),
    WALLY_STORAGE_SIGNING_KEY: z.string().optional(),
    JWT_SECRET: z.string().default('dev_change_me_please'),
    WALLY_GET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  })
  .transform((e) => ({
    dir: e.WALLY_STORAGE_DIR,
    signingKey: e.WALLY_STORAGE_SIGNING_KEY ?? e.JWT_SECRET,
    getTokenTtlSeconds: e.WALLY_GET_TOKEN_TTL_SECONDS,
  }));

/** Decoded payload of a signed get-token. */
interface GetTokenPayload {
  k: string; // storage key
  exp: number; // unix ms
}

/**
 * The contract the rest of the API codes against. LocalDiskStorage is the only
 * implementation today; keeping the interface explicit means a future Railway
 * object-store driver can slot in without touching call sites.
 */
export interface Storage {
  /** Persist bytes and return the storage key to reference them by. */
  put(bytes: Buffer, opts?: { ext?: string; prefix?: string }): Promise<string>;
  /** Read the raw bytes for a key. Throws NotFound if the key is unknown. */
  getBytes(key: string): Promise<Buffer>;
  /** True if an object exists for the key. */
  exists(key: string): Promise<boolean>;
  /** Best-effort delete; a missing key is not an error. */
  remove(key: string): Promise<void>;
  /** Mint a short-lived signed token granting read access to one key. */
  signedGetToken(key: string, ttlSeconds?: number): string;
  /** Verify a signed get-token and return its key, or throw. */
  verifyGetToken(token: string): string;
  /** Full URL a browser can GET to stream the object via the API. */
  signedGetUrl(key: string, ttlSeconds?: number): string;
}

@Injectable()
export class StorageService implements Storage {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;
  private readonly signingKey: string;
  private readonly defaultTtlSeconds: number;

  constructor() {
    const cfg = StorageEnv.parse(process.env);
    this.root = resolve(cfg.dir);
    this.signingKey = cfg.signingKey;
    this.defaultTtlSeconds = cfg.getTokenTtlSeconds;

    // Create the root eagerly so the first upload doesn't race a mkdir. If the
    // Volume isn't mounted yet we fail loudly here at boot rather than on the
    // first store-manager photo upload.
    mkdirSync(this.root, { recursive: true });
    this.logger.log(
      `StorageService: disk backend (root=${this.root}). On Railway, attach a Volume here so photos survive redeploys.`,
    );
  }

  // ----- public API --------------------------------------------------------

  async put(
    bytes: Buffer,
    opts: { ext?: string; prefix?: string } = {},
  ): Promise<string> {
    const ext = normaliseExt(opts.ext);
    const prefix = (opts.prefix ?? 'photos').replace(/[^a-zA-Z0-9._-]/g, '');
    // Content-addressable-ish key: date-sharded dir + random id keeps the
    // filesystem from ballooning one giant directory while staying opaque.
    const day = new Date().toISOString().slice(0, 10);
    const id = randomBytes(16).toString('hex');
    const key = `${prefix}/${day}/${id}${ext}`;

    const path = this.diskPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    // NEVER log the bytes — only the key and size.
    this.logger.debug(`stored ${key} (${bytes.length} bytes)`);
    return key;
  }

  async getBytes(key: string): Promise<Buffer> {
    try {
      return await readFile(this.diskPath(key));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        throw new NotFoundException(`storage key not found: ${key}`);
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.diskPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.diskPath(key));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw err;
    }
  }

  // ----- signed read tokens ------------------------------------------------

  signedGetToken(key: string, ttlSeconds = this.defaultTtlSeconds): string {
    const payload: GetTokenPayload = {
      k: key,
      exp: Date.now() + ttlSeconds * 1000,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const sig = this.sign(payloadB64);
    return `${payloadB64}.${sig}`;
  }

  verifyGetToken(token: string): string {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new NotFoundException('malformed storage token');
    }
    const [payloadB64, sigHex] = parts as [string, string];
    const expected = this.sign(payloadB64);
    const a = Buffer.from(sigHex, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new NotFoundException('bad storage token signature');
    }
    let payload: GetTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as GetTokenPayload;
    } catch {
      throw new NotFoundException('storage token payload not JSON');
    }
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      throw new NotFoundException('storage token expired');
    }
    if (typeof payload.k !== 'string' || !payload.k) {
      throw new NotFoundException('storage token missing key');
    }
    return payload.k;
  }

  signedGetUrl(key: string, ttlSeconds = this.defaultTtlSeconds): string {
    const token = this.signedGetToken(key, ttlSeconds);
    const base = (process.env.APP_URL_API ?? '').replace(/\/+$/, '');
    // Relative when no API base configured — the SPA resolves it against origin.
    return `${base}/photos/blob/${token}`;
  }

  // ----- internals ---------------------------------------------------------

  /**
   * Resolve a storage key to an absolute path, refusing any key that would
   * escape the storage root (e.g. "../../etc/passwd").
   */
  private diskPath(key: string): string {
    const safeKey = key
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    const full = normalize(join(this.root, safeKey));
    if (!full.startsWith(this.root + sep) && full !== this.root) {
      throw new InternalServerErrorException('storage key escapes root');
    }
    return full;
  }

  private sign(payloadB64: string): string {
    return createHmac('sha256', this.signingKey).update(payloadB64).digest('hex');
  }
}

function normaliseExt(ext?: string): string {
  if (!ext) return '.jpg';
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const withDot = cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
  // Only allow the image extensions we ever produce/accept.
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(withDot) ? withDot : '.jpg';
}
