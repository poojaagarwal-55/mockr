// ============================================
// Cloudflare R2 Client (S3-compatible)
// ============================================

import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type R2Config = {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    region: string;
};

function getR2Config(): R2Config {
    const endpoint = process.env.S3_ENDPOINT?.trim() || "";
    const bucket = process.env.S3_BUCKET?.trim() || "interviewforge-resumes";
    const accessKey = process.env.S3_ACCESS_KEY?.trim() || "";
    const secretKey = process.env.S3_SECRET_KEY?.trim() || "";
    const region = process.env.S3_REGION?.trim() || "auto";

    if (!endpoint || !accessKey || !secretKey) {
        throw new Error(
            "Missing required Cloudflare R2 credentials. Please set S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY in your .env file."
        );
    }

    return { endpoint, bucket, accessKey, secretKey, region };
}

let cachedClient: S3Client | null = null;

function getS3Client(): S3Client {
    if (cachedClient) return cachedClient;

    const cfg = getR2Config();
    cachedClient = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
            accessKeyId: cfg.accessKey,
            secretAccessKey: cfg.secretKey,
        },
        forcePathStyle: true,
        // R2 doesn't support SDK v3's automatic checksum headers
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });

    return cachedClient;
}

/**
 * Upload a file buffer to Cloudflare R2.
 * Returns the public URL of the uploaded object.
 */
export async function uploadToR2(
    key: string,
    body: Buffer,
    contentType: string
): Promise<string> {
    const cfg = getR2Config();
    const s3 = getS3Client();

    await s3.send(
        new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: body.length,
        })
    );

    // Use a dedicated public URL if configured, otherwise fall back to the S3 endpoint
    const publicBase = process.env.R2_PUBLIC_URL || cfg.endpoint;
    const base = publicBase.replace(/\/$/, "");
    return `${base}/${cfg.bucket}/${key}`;
}

/**
 * Upload a private object to the default R2 bucket.
 * Used for server-only artifacts that are later accessed through short-lived
 * presigned URLs.
 */
export async function uploadPrivateObjectToR2(
    key: string,
    body: Buffer,
    contentType: string
): Promise<{ bucket: string; key: string }> {
    const cfg = getR2Config();
    const s3 = getS3Client();

    await s3.send(
        new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: body.length,
            ServerSideEncryption: "AES256",
        })
    );

    return { bucket: cfg.bucket, key };
}

/**
 * Upload a file buffer to the dedicated avatar bucket.
 * Uses R2_AVATAR_BUCKET and R2_AVATAR_PUBLIC_URL env vars.
 */
export async function uploadToR2Avatar(
    key: string,
    body: Buffer,
    contentType: string
): Promise<string> {
    const cfg = getR2Config();
    const avatarBucket = process.env.R2_AVATAR_BUCKET?.trim() || "interviewforge-avatars";
    const s3 = getS3Client();

    await s3.send(
        new PutObjectCommand({
            Bucket: avatarBucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: body.length,
        })
    );

    const publicBase = (process.env.R2_AVATAR_PUBLIC_URL || "").replace(/\/$/, "");
    if (publicBase) return `${publicBase}/${key}`;
    // Fallback: construct from endpoint
    const base = cfg.endpoint.replace(/\/$/, "");
    return `${base}/${avatarBucket}/${key}`;
}

function getBlogImagesBucket(): string {
    return process.env.R2_BLOG_IMAGES_BUCKET?.trim() || "blog-images";
}

function getBlogImagesPublicBase(): string {
    const publicBase = (process.env.R2_BLOG_IMAGES_PUBLIC_URL || "").trim().replace(/\/$/, "");

    if (!publicBase) {
        throw new Error(
            "Missing R2_BLOG_IMAGES_PUBLIC_URL. Configure a public R2 bucket URL for blog images."
        );
    }

    return publicBase;
}

/**
 * Upload a blog image to the dedicated public blog-images bucket.
 * Reuses the main S3/R2 credentials while keeping the bucket and public URL separate.
 */
export async function uploadToR2BlogImage(
    key: string,
    body: Buffer,
    contentType: string
): Promise<string> {
    const s3 = getS3Client();

    await s3.send(
        new PutObjectCommand({
            Bucket: getBlogImagesBucket(),
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: body.length,
            CacheControl: "public, max-age=31536000, immutable",
        })
    );

    return `${getBlogImagesPublicBase()}/${key}`;
}

/**
 * Delete a file from Cloudflare R2.
 */
export async function deleteFromR2(key: string): Promise<void> {
    const cfg = getR2Config();
    const s3 = getS3Client();

    await s3.send(
        new DeleteObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
        })
    );
}

/**
 * Check whether an object exists in R2 using a lightweight HEAD request.
 * Returns true if the object exists, false if it has been deleted (NoSuchKey / 404).
 */
export async function objectExistsInR2(key: string): Promise<boolean> {
    const cfg = getR2Config();
    const s3 = getS3Client();

    try {
        await s3.send(
            new HeadObjectCommand({
                Bucket: cfg.bucket,
                Key: key,
            })
        );
        return true;
    } catch (err: any) {
        // R2 returns 404 / NoSuchKey when the object doesn't exist
        if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
            return false;
        }
        // Any other error (e.g. auth, network) — assume it might exist to avoid false deletes
        throw err;
    }
}

/**
 * Delete a file from the avatar bucket.
 */
export async function deleteFromR2Avatar(key: string): Promise<void> {
    const avatarBucket = process.env.R2_AVATAR_BUCKET?.trim() || "interviewforge-avatars";
    const s3 = getS3Client();

    await s3.send(
        new DeleteObjectCommand({
            Bucket: avatarBucket,
            Key: key,
        })
    );
}

/**
 * Generate a presigned download URL for an R2 object.
 * URL expires after the given number of seconds (default: 5 minutes).
 */
export async function getPresignedDownloadUrl(
    key: string,
    expiresInSeconds = 300
): Promise<string> {
    const cfg = getR2Config();
    const s3 = getS3Client();

    const command = new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
    });
    return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

// ============================================
// Interview Recordings Bucket — Separate Client
// ============================================

type R2RecordingsConfig = {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
};

function getRecordingsConfig(): R2RecordingsConfig {
    const endpoint = process.env.R2_RECORDINGS_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim() || "";
    const bucket = process.env.R2_RECORDINGS_BUCKET?.trim() || "practers-recordings";
    const accessKey = process.env.R2_RECORDINGS_ACCESS_KEY?.trim() || process.env.S3_ACCESS_KEY?.trim() || "";
    const secretKey = process.env.R2_RECORDINGS_SECRET_KEY?.trim() || process.env.S3_SECRET_KEY?.trim() || "";

    if (!endpoint || !accessKey || !secretKey) {
        throw new Error(
            "Missing R2 recordings credentials. Set R2_RECORDINGS_ENDPOINT, R2_RECORDINGS_ACCESS_KEY, R2_RECORDINGS_SECRET_KEY in your .env file."
        );
    }

    return { endpoint, bucket, accessKey, secretKey };
}

let cachedRecordingsClient: S3Client | null = null;

function getRecordingsClient(): S3Client {
    if (cachedRecordingsClient) return cachedRecordingsClient;

    const cfg = getRecordingsConfig();
    cachedRecordingsClient = new S3Client({
        region: "auto",
        endpoint: cfg.endpoint,
        credentials: {
            accessKeyId: cfg.accessKey,
            secretAccessKey: cfg.secretKey,
        },
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });

    return cachedRecordingsClient;
}

function getRecordingsBucket(): string {
    return process.env.R2_RECORDINGS_BUCKET?.trim() || "practers-recordings";
}

/**
 * Step 1 of multipart upload: create an upload session in R2.
 * Returns the UploadId needed for all subsequent part operations.
 */
export async function createMultipartUpload(
    key: string,
    mimeType: string
): Promise<string> {
    const s3 = getRecordingsClient();

    const res = await s3.send(
        new CreateMultipartUploadCommand({
            Bucket: getRecordingsBucket(),
            Key: key,
            ContentType: mimeType,
        })
    );

    if (!res.UploadId) {
        throw new Error("[R2] CreateMultipartUpload returned no UploadId");
    }
    return res.UploadId;
}

/**
 * Step 2 of multipart upload: generate a presigned PUT URL for one specific part.
 * The browser uses this URL to PUT the part bytes directly to R2.
 * partNumber is 1-indexed (1–10,000).
 */
export async function getPresignedPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds = 3600
): Promise<string> {
    const s3 = getRecordingsClient();

    const command = new UploadPartCommand({
        Bucket: getRecordingsBucket(),
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
    });
    return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Step 3 of multipart upload: tell R2 to assemble all uploaded parts into
 * the final object. Parts must be sorted by PartNumber ascending.
 * R2 deletes the temporary part fragments after assembly.
 */
export async function completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { PartNumber: number; ETag: string }[]
): Promise<void> {
    const s3 = getRecordingsClient();
    const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

    await s3.send(
        new CompleteMultipartUploadCommand({
            Bucket: getRecordingsBucket(),
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: sorted },
        })
    );
}

/**
 * Abort an in-progress multipart upload.
 * Cleans up all temporary part fragments from R2 to avoid orphaned storage.
 */
export async function abortMultipartUpload(
    key: string,
    uploadId: string
): Promise<void> {
    const s3 = getRecordingsClient();

    await s3.send(
        new AbortMultipartUploadCommand({
            Bucket: getRecordingsBucket(),
            Key: key,
            UploadId: uploadId,
        })
    );
}

/**
 * Generate a presigned GET URL for recording playback/download.
 * Content-Disposition is always "attachment" — both PRO and MAX can download.
 * Expires in 1 hour by default.
 */
export async function getRecordingPresignedDownloadUrl(
    key: string,
    expiresInSeconds = 3600
): Promise<string> {
    const s3 = getRecordingsClient();

    const command = new GetObjectCommand({
        Bucket: getRecordingsBucket(),
        Key: key,
        ResponseContentDisposition: "attachment; filename=interview-recording",
    });
    return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Delete a recording object from R2.
 * Used by the expiry cleanup job and the DELETE endpoint.
 */
export async function deleteRecording(key: string): Promise<void> {
    const s3 = getRecordingsClient();

    await s3.send(
        new DeleteObjectCommand({
            Bucket: getRecordingsBucket(),
            Key: key,
        })
    );
}
