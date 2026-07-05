import { encode } from 'blurhash';
import exifr from 'exifr';
import { fitWithin } from '$lib/domain/dims';
import { itemDateFrom, type ItemDate } from '$lib/domain/dates';

export interface PhotoDerivatives {
	poster: Blob;
	thumb_400: Blob;
	thumb_800: Blob;
	thumb_1600: Blob;
	blurhash: string | null;
	width: number;
	height: number;
	date: ItemDate | null;
}

export async function derivePhoto(file: File): Promise<PhotoDerivatives> {
	const bitmap = await createImageBitmap(file);
	const poster = await renderBitmap(bitmap, bitmap.width);
	const thumb_400 = await renderBitmap(bitmap, 400);
	const thumb_800 = await renderBitmap(bitmap, 800);
	const thumb_1600 = await renderBitmap(bitmap, 1600);
	const blurhash = await blurhashFor(bitmap).catch(() => null);
	const date = await exifDate(file).catch(() => null);

	return {
		poster,
		thumb_400,
		thumb_800,
		thumb_1600,
		blurhash,
		width: bitmap.width,
		height: bitmap.height,
		date
	};
}

async function renderBitmap(bitmap: ImageBitmap, maxWidth: number): Promise<Blob> {
	const dims = fitWithin(bitmap.width, bitmap.height, maxWidth);
	const canvas = document.createElement('canvas');
	canvas.width = dims.width;
	canvas.height = dims.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not available');
	ctx.drawImage(bitmap, 0, 0, dims.width, dims.height);
	return await canvasToBlob(canvas);
}

async function blurhashFor(bitmap: ImageBitmap): Promise<string> {
	const dims = fitWithin(bitmap.width, bitmap.height, 32);
	const canvas = document.createElement('canvas');
	canvas.width = dims.width;
	canvas.height = dims.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not available');
	ctx.drawImage(bitmap, 0, 0, dims.width, dims.height);
	const data = ctx.getImageData(0, 0, dims.width, dims.height);
	return encode(data.data, dims.width, dims.height, 4, 3);
}

async function exifDate(file: File): Promise<ItemDate | null> {
	const parsed = (await exifr.parse(file, ['DateTimeOriginal'])) as
		{ DateTimeOriginal?: Date } | undefined;
	const date = parsed?.DateTimeOriginal;
	if (!date) return null;
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	return itemDateFrom({ precision: 'day', day: `${yyyy}-${mm}-${dd}` });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode canvas'))),
			'image/webp',
			0.86
		);
	});
}
