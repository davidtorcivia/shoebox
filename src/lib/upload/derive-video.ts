import { fitWithin } from '$lib/domain/dims';
import { type ItemDate } from '$lib/domain/dates';
import { guessDateFromFile } from './date-guess';

export interface VideoDerivatives {
	poster: Blob;
	thumb_400: Blob;
	thumb_800: Blob;
	thumb_1600: Blob;
	width: number;
	height: number;
	duration: number;
	date: ItemDate | null;
}

export async function deriveVideo(file: File): Promise<VideoDerivatives> {
	const url = URL.createObjectURL(file);
	try {
		const video = document.createElement('video');
		video.preload = 'metadata';
		video.muted = true;
		video.src = url;
		await once(video, 'loadedmetadata', unsupportedVideoMessage(file));
		video.currentTime = Math.min(0.1, Math.max(video.duration / 2, 0));
		await once(video, 'seeked', 'Video preview frame could not be read.');

		return {
			poster: await renderVideo(video, video.videoWidth),
			thumb_400: await renderVideo(video, 400),
			thumb_800: await renderVideo(video, 800),
			thumb_1600: await renderVideo(video, 1600),
			width: video.videoWidth,
			height: video.videoHeight,
			duration: video.duration,
			date: guessDateFromFile(file)
		};
	} finally {
		URL.revokeObjectURL(url);
	}
}

function unsupportedVideoMessage(file: File): string {
	const type = file.type.toLowerCase();
	const name = file.name.toLowerCase();
	if (type.includes('quicktime') || /\.(mov|m4v)$/.test(name)) {
		return 'This browser could not decode the iPhone video for a poster frame. The original file is supported, but MOV conversion needs browser codec support or server-side conversion.';
	}
	return 'This browser could not decode the video for a poster frame.';
}

async function renderVideo(video: HTMLVideoElement, maxWidth: number): Promise<Blob> {
	const dims = fitWithin(video.videoWidth, video.videoHeight, maxWidth);
	const canvas = document.createElement('canvas');
	canvas.width = dims.width;
	canvas.height = dims.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not available');
	ctx.drawImage(video, 0, 0, dims.width, dims.height);
	return await canvasToBlob(canvas);
}

function once(target: EventTarget, event: string, errorMessage: string): Promise<void> {
	return new Promise((resolve, reject) => {
		target.addEventListener(event, () => resolve(), { once: true });
		target.addEventListener('error', () => reject(new Error(errorMessage)), {
			once: true
		});
	});
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
