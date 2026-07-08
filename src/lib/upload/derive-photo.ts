import { encode } from 'blurhash';
import exifr from 'exifr';
import { fitWithin } from '$lib/domain/dims';
import { itemDateFrom, type ItemDate } from '$lib/domain/dates';
import { guessDateFromFile } from './date-guess';

export interface PhotoDerivatives {
	poster: Blob | null;
	thumb_400: Blob | null;
	thumb_800: Blob | null;
	thumb_1600: Blob | null;
	blurhash: string | null;
	width: number;
	height: number;
	date: ItemDate | null;
	/**
	 * True when the browser could not decode the original (HEIC / camera RAW).
	 * The item uploads with no client thumbnails and the worker builds every
	 * derivative — plus dimensions and blurhash — server-side from the original.
	 */
	deferred: boolean;
}

export async function derivePhoto(file: File): Promise<PhotoDerivatives> {
	const bitmap = await createBitmap(file);
	if (bitmap) {
		const poster = await renderBitmap(bitmap, bitmap.width);
		const thumb_400 = await renderBitmap(bitmap, 400);
		const thumb_800 = await renderBitmap(bitmap, 800);
		const thumb_1600 = await renderBitmap(bitmap, 1600);
		const blurhash = await blurhashFor(bitmap).catch(() => null);
		const date = (await exifDate(file).catch(() => null)) ?? guessDateFromFile(file);
		return {
			poster,
			thumb_400,
			thumb_800,
			thumb_1600,
			blurhash,
			width: bitmap.width,
			height: bitmap.height,
			date,
			deferred: false
		};
	}

	// Deferred (HEIC/RAW): no pixels available in this browser. Read whatever
	// dimensions and date EXIF exposes; the worker fills in the rest.
	const meta = await exifMeta(file).catch(() => null);
	const date = meta?.date ?? guessDateFromFile(file);
	return {
		poster: null,
		thumb_400: null,
		thumb_800: null,
		thumb_1600: null,
		blurhash: null,
		width: meta?.width ?? 0,
		height: meta?.height ?? 0,
		date,
		deferred: true
	};
}

/** Returns null when the format is one we intentionally decode server-side. */
async function createBitmap(file: File): Promise<ImageBitmap | null> {
	try {
		return await createImageBitmap(file);
	} catch (err) {
		if (isServerDecodable(file)) return null;
		throw err;
	}
}

const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|rw2|raf|orf)$/i;

function isServerDecodable(file: File): boolean {
	const type = file.type.toLowerCase();
	const name = file.name.toLowerCase();
	return (
		type.includes('heic') ||
		type.includes('heif') ||
		/\.(heic|heif)$/.test(name) ||
		/x-(canon|nikon|sony|adobe|panasonic|fujifilm|olympus)/.test(type) ||
		RAW_EXT.test(name)
	);
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

function dateFrom(value: Date): ItemDate {
	const yyyy = value.getFullYear();
	const mm = String(value.getMonth() + 1).padStart(2, '0');
	const dd = String(value.getDate()).padStart(2, '0');
	return itemDateFrom({ precision: 'day', day: `${yyyy}-${mm}-${dd}` });
}

async function exifDate(file: File): Promise<ItemDate | null> {
	const parsed = (await exifr.parse(file, ['DateTimeOriginal'])) as
		{ DateTimeOriginal?: Date } | undefined;
	const date = parsed?.DateTimeOriginal;
	return date ? dateFrom(date) : null;
}

interface ExifMeta {
	width: number | null;
	height: number | null;
	date: ItemDate | null;
}

async function exifMeta(file: File): Promise<ExifMeta> {
	const parsed = (await exifr.parse(file, [
		'DateTimeOriginal',
		'ExifImageWidth',
		'ExifImageHeight',
		'ImageWidth',
		'ImageHeight'
	])) as
		| {
				DateTimeOriginal?: Date;
				ExifImageWidth?: number;
				ExifImageHeight?: number;
				ImageWidth?: number;
				ImageHeight?: number;
		  }
		| undefined;
	return {
		width: parsed?.ExifImageWidth ?? parsed?.ImageWidth ?? null,
		height: parsed?.ExifImageHeight ?? parsed?.ImageHeight ?? null,
		date: parsed?.DateTimeOriginal ? dateFrom(parsed.DateTimeOriginal) : null
	};
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
