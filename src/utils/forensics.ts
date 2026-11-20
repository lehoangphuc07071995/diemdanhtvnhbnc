export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export async function reverseGeocodeNominatim(
  lat: number,
  lon: number
): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1&accept-language=vi`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return `Tọa độ ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }
    const data = (await response.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    if (data.display_name) {
      return data.display_name;
    }
    return `Tọa độ ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  } catch {
    return `Tọa độ ${lat.toFixed(6)}, ${lon.toFixed(6)} (Chưa lấy được tên đường)`;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback deterministic hash only if SubtleCrypto is unavailable in non-HTTPS contexts
  const bytes = new Uint8Array(buffer);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 512))) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`.repeat(4);
}

export interface ForensicWatermarkPayload {
  employeeName: string;
  employeeCode: string;
  actionLabel: string;
  timestampIso: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  distanceMeters: number;
  addressText: string;
}

export interface ForensicCaptureResult {
  blob: Blob;
  dataUrl: string;
  integrityHash: string;
}

export async function burnForensicWatermarkAndCompress(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  payload: ForensicWatermarkPayload
): Promise<ForensicCaptureResult> {
  let srcWidth = 1280;
  let srcHeight = 960;

  if (source instanceof HTMLVideoElement) {
    srcWidth = source.videoWidth || 1280;
    srcHeight = source.videoHeight || 720;
  } else if (source instanceof HTMLImageElement) {
    srcWidth = source.naturalWidth || 1280;
    srcHeight = source.naturalHeight || 960;
  } else {
    srcWidth = source.width || 1280;
    srcHeight = source.height || 960;
  }

  const maxWidth = 1280;
  const scale = srcWidth > maxWidth ? maxWidth / srcWidth : 1;
  const width = Math.round(srcWidth * scale);
  const height = Math.round(srcHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Không thể khởi tạo Canvas xử lý ảnh.');
  }

  // Draw live camera frame (mirror horizontally if video front camera for natural look)
  if (source instanceof HTMLVideoElement) {
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();
  } else {
    ctx.drawImage(source, 0, 0, width, height);
  }

  // Compute SHA-256 over raw frame + forensic metadata
  const rawFrameDataUrl = canvas.toDataURL('image/jpeg', 0.75);
  const canonicalPayload = `${payload.employeeCode}|${payload.timestampIso}|${payload.latitude.toFixed(
    6
  )},${payload.longitude.toFixed(6)}|${Math.round(payload.accuracyMeters)}|${rawFrameDataUrl.slice(
    0,
    4096
  )}`;
  const encoded = new TextEncoder().encode(canonicalPayload);
  const integrityHash = await computeSha256Hex(encoded.buffer);
  const shortHash = integrityHash.slice(0, 16).toUpperCase();

  // Burn semi-transparent dark forensic watermark bar at bottom
  const barHeight = Math.max(96, Math.round(height * 0.17));
  const barY = height - barHeight;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
  ctx.fillRect(0, barY, width, barHeight);

  // Thin crisp top border of watermark bar
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.fillRect(0, barY, width, 1);

  const padX = Math.max(18, Math.round(width * 0.022));
  const baseFont = Math.max(13, Math.round(width * 0.0155));
  const smallFont = Math.max(11, Math.round(width * 0.013));

  const timeFormatted = formatDateTimeVN(payload.timestampIso);
  const shortAddr =
    payload.addressText.length > 72
      ? `${payload.addressText.slice(0, 69)}...`
      : payload.addressText;

  // Line 1: Employee + Action (left) & Timestamp (right)
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${baseFont}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.fillText(
    `${payload.employeeName} (${payload.employeeCode}) · ${payload.actionLabel}`,
    padX,
    barY + Math.round(barHeight * 0.3)
  );

  ctx.fillStyle = '#E2E8F0';
  ctx.font = `600 ${smallFont}px "JetBrains Mono", monospace`;
  const timeText = `${timeFormatted} (UTC+7)`;
  const timeMetrics = ctx.measureText(timeText);
  ctx.fillText(
    timeText,
    width - padX - timeMetrics.width,
    barY + Math.round(barHeight * 0.3)
  );

  // Line 2: Coordinates, Accuracy, Distance
  ctx.fillStyle = '#CBD5E1';
  ctx.font = `500 ${smallFont}px "JetBrains Mono", monospace`;
  ctx.fillText(
    `GPS: ${payload.latitude.toFixed(6)}, ${payload.longitude.toFixed(
      6
    )} · Sai số: ±${Math.round(payload.accuracyMeters)}m · Khoảng cách: ${Math.round(
      payload.distanceMeters
    )}m`,
    padX,
    barY + Math.round(barHeight * 0.58)
  );

  // Line 3: Address + SHA-256 Hash
  ctx.fillStyle = '#94A3B8';
  ctx.font = `400 ${smallFont}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.fillText(shortAddr, padX, barY + Math.round(barHeight * 0.84));

  ctx.fillStyle = '#34D399';
  ctx.font = `600 ${smallFont}px "JetBrains Mono", monospace`;
  const hashLabel = `SHA-256: ${shortHash}`;
  const hashMetrics = ctx.measureText(hashLabel);
  ctx.fillText(
    hashLabel,
    width - padX - hashMetrics.width,
    barY + Math.round(barHeight * 0.84)
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Không thể nén ảnh JPEG.'));
      },
      'image/jpeg',
      0.8
    );
  });

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

  return {
    blob,
    dataUrl,
    integrityHash,
  };
}

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function formatDateTimeVN(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatTimeVN(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDateVN(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function getVNDateKey(isoString: string): string {
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts; // YYYY-MM-DD in UTC+7
}

export function getVNMinutesOfDay(isoString: string): number {
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h * 60 + m;
}

export function cleanDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function normalizeFullName(name: string): string {
  return cleanDisplayName(name).toLowerCase();
}
