/**
 * Файлы кампании: загрузка кусками (картинки перед загрузкой ужимаются в WebP), ссылки и кэш для музыки.
 */
import { api, ApiError } from '../api/client';

export type FileKind = 'image' | 'map' | 'audio';
export interface CampaignFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: FileKind;
  ownerId: string;
  createdAt: string;
}

export const fileUrl = (id: string) => `/api/files/${id}`;

/** Название трека — имя файла без расширения, как назвал сам мастер */
export const trackName = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '');

/** Картинку — в WebP, длинная сторона не больше max. Если браузер не умеет, отдаём как есть. */
async function shrinkImage(file: File, max: number): Promise<{ blob: Blob; name: string; width?: number; height?: number }> {
  if (file.type === 'image/gif') return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.86));
    if (!blob || blob.size >= file.size && scale === 1) return { blob: file, name: file.name, width: bmp.width, height: bmp.height };
    return { blob, name: file.name.replace(/\.[a-z0-9]+$/i, '') + '.webp', width: w, height: h };
  } catch {
    return { blob: file, name: file.name };
  }
}

export interface Uploaded extends CampaignFile {
  width?: number;
  height?: number;
}

/** Загрузить файл в кампанию. onProgress — доля от 0 до 1. */
export async function uploadFile(campaignId: string, file: File, kind: FileKind, onProgress?: (p: number) => void): Promise<Uploaded> {
  let blob: Blob = file;
  let name = file.name;
  let width: number | undefined;
  let height: number | undefined;
  if (kind !== 'audio') ({ blob, name, width, height } = await shrinkImage(file, kind === 'map' ? 4096 : 2560));
  const mime = blob.type || file.type || (kind === 'audio' ? 'audio/mpeg' : 'image/png');
  const meta = await api<{ id: string; chunkSize: number; chunks: number }>(`/campaigns/${campaignId}/files`, { body: { name, mime, size: blob.size, kind } });
  for (let i = 0; i < meta.chunks; i++) {
    const part = blob.slice(i * meta.chunkSize, Math.min(blob.size, (i + 1) * meta.chunkSize));
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const res = await fetch(`/api/files/${meta.id}/chunks/${i}`, { method: 'PUT', body: part, credentials: 'same-origin' });
      if (res.ok) ok = true;
      else if (res.status < 500) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error ?? `Ошибка ${res.status}`);
      } else await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!ok) throw new Error('Не удалось загрузить файл — проверьте связь');
    onProgress?.((i + 1) / meta.chunks);
  }
  const { file: done } = await api<{ file: CampaignFile }>(`/files/${meta.id}/complete`, { body: {} });
  return { ...done, width, height };
}

/** Размер картинки в пикселях — для карты */
export function imageSize(id: string): Promise<{ width: number; height: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => rej(new Error('Картинка не загрузилась'));
    img.src = fileUrl(id);
  });
}

/** Музыка: файл скачивается целиком один раз, дальше играет из памяти (перемотка и повтор без запросов) */
const blobs = new Map<string, Promise<string>>();
export function blobUrl(id: string): Promise<string> {
  let p = blobs.get(id);
  if (!p) {
    p = fetch(fileUrl(id), { credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok) throw new Error('Трек не загрузился');
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => blobs.delete(id));
    blobs.set(id, p);
  }
  return p;
}

export const formatSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1e3))} КБ`);
