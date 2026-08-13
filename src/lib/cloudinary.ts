/**
 * Cloudinary unsigned upload utility.
 *
 * Reads VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET from
 * the environment. Both are set via Replit Secrets.
 */

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

/** Maximum allowed file size (5 MB). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

export function isCloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && UPLOAD_PRESET);
}

export interface UploadResult {
  /** Public Cloudinary URL for viewing. */
  fileUrl: string;
  /** URL with fl_attachment for forced download. */
  downloadUrl: string;
  /** Cloudinary public_id — kept for future management. */
  publicId: string;
}

function buildDeliveryUrls(
  data: { secure_url?: string; public_id?: string; version?: number; resource_type?: string; format?: string },
  file: File,
): { fileUrl: string; downloadUrl: string } {
  const isPdf = file.type === 'application/pdf'
    || (data.resource_type === 'image' && data.format?.toLowerCase() === 'pdf');
  const resourceType = isPdf ? 'image' : (data.resource_type || 'auto');
  let fileUrl = data.secure_url || '';

  // Cloudinary's auto-upload response can contain a delivery URL with a
  // different resource type. PDFs must use the image delivery path.
  if (fileUrl) {
    fileUrl = fileUrl.replace(/\/(?:auto|image|raw|video)\/upload\//, `/${resourceType}/upload/`);
  } else if (data.public_id) {
    const version = data.version ? `/v${data.version}` : '';
    const extension = data.format && !data.public_id.toLowerCase().endsWith(`.${data.format.toLowerCase()}`)
      ? `.${data.format}`
      : '';
    fileUrl = `https://res.cloudinary.com/${CLOUD_NAME}/${resourceType}/upload${version}/${data.public_id}${extension}`;
  }

  return {
    fileUrl,
    downloadUrl: fileUrl.replace('/upload/', '/upload/fl_attachment/'),
  };
}

/**
 * Upload a file to Cloudinary via unsigned upload.
 *
 * @param file           The file to upload.
 * @param onProgress     Optional callback receiving 0–100 progress value.
 */
export function uploadToCloudinary(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    return Promise.reject(
      new Error(
        'Cloudinary is not configured. Please set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET.',
      ),
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return Promise.reject(
      new Error(
        `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 5 MB.`,
      ),
    );
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const { fileUrl, downloadUrl } = buildDeliveryUrls(data, file);
          if (!fileUrl || !data.public_id) {
            reject(new Error('Cloudinary returned an incomplete upload response.'));
            return;
          }
          resolve({ fileUrl, downloadUrl, publicId: data.public_id });
        } catch {
          reject(new Error('Failed to parse Cloudinary response.'));
        }
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`;
        try {
          const err = JSON.parse(xhr.responseText);
          if (err?.error?.message) msg = err.error.message;
        } catch {/* ignore */}
        reject(new Error(msg));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled.')));

    xhr.send(formData);
  });
}
