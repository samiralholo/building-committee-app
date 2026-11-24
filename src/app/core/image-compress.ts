export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
}

const MAX_WIDTH = 1200;
const START_QUALITY = 0.72;
const TARGET_BYTES = 150 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذر قراءة الصورة'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('تعذر ضغط الصورة'))), 'image/jpeg', quality),
  );
}

/**
 * Resizes to max 1200px wide and encodes as JPEG at quality 0.72, then steps quality
 * (and finally size) down until the file is under ~150KB. JPEG is used because every
 * phone browser can encode it (Safari's canvas cannot always encode WebP).
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const img = await loadImage(file);
  let width = Math.min(img.naturalWidth, MAX_WIDTH);
  let height = Math.round((img.naturalHeight * width) / img.naturalWidth);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('المتصفح لا يدعم ضغط الصور');

  const draw = () => {
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#FFFFFF'; // flatten transparent PNGs
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
  };

  draw();
  let quality = START_QUALITY;
  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > TARGET_BYTES && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, quality);
  }
  while (blob.size > TARGET_BYTES && width > 600) {
    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    draw();
    blob = await canvasToBlob(canvas, quality);
  }

  return { blob, width, height, originalBytes: file.size };
}

/** "2.4MB" / "115KB" — Latin units read clearly next to the arrow in an RTL sentence. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
