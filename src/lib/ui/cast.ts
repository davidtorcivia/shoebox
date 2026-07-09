// Minimal typed surface over Google's Cast sender SDK, loaded lazily from
// gstatic only in Chromium browsers that can actually cast. Kept deliberately
// small — just the slice the player uses to hand a media URL to a receiver.

interface CastMetadata {
	title?: string;
	images?: unknown[];
}

interface CastMediaInfo {
	metadata?: CastMetadata;
}

interface CastSession {
	loadMedia(request: unknown): Promise<void>;
}

interface CastContext {
	setOptions(opts: { receiverApplicationId: string; autoJoinPolicy: string }): void;
	getCastState(): string;
	addEventListener(type: string, handler: (event: { castState: string }) => void): void;
	removeEventListener(type: string, handler: (event: { castState: string }) => void): void;
	requestSession(): Promise<void>;
	getCurrentSession(): CastSession | null;
}

export interface CastFramework {
	CastContext: { getInstance(): CastContext };
	CastState: {
		NO_DEVICES_AVAILABLE: string;
		NOT_CONNECTED: string;
		CONNECTING: string;
		CONNECTED: string;
	};
	CastContextEventType: { CAST_STATE_CHANGED: string };
}

interface ChromeCast {
	media: {
		DEFAULT_MEDIA_RECEIVER_APP_ID: string;
		MediaInfo: new (url: string, contentType: string) => CastMediaInfo;
		GenericMediaMetadata: new () => CastMetadata;
		LoadRequest: new (info: CastMediaInfo) => unknown;
	};
	AutoJoinPolicy: { ORIGIN_SCOPED: string };
	Image: new (url: string) => unknown;
}

interface CastWindow {
	cast?: { framework?: CastFramework };
	chrome?: { cast?: ChromeCast };
	__onGCastApiAvailable?: (available: boolean) => void;
}

const SDK_URL = 'https://www.gstatic.com/cast/sdk/libs/sender/1.0/cast_framework.js';

export type CastState = 'off' | 'available' | 'connecting' | 'connected';

function castWindow(): CastWindow {
	return window as unknown as CastWindow;
}

let frameworkPromise: Promise<CastFramework | null> | null = null;

/**
 * Load and initialise the Cast framework once per page. Resolves null where Cast
 * is unavailable (non-Chromium browser, blocked script, or SDK reports no API),
 * so callers can silently fall back to AirPlay / Remote Playback.
 */
export function loadCastFramework(): Promise<CastFramework | null> {
	if (typeof window === 'undefined') return Promise.resolve(null);
	if (frameworkPromise) return frameworkPromise;
	frameworkPromise = new Promise<CastFramework | null>((resolve) => {
		const w = castWindow();
		if (w.cast?.framework) return resolve(w.cast.framework);
		// The Cast sender SDK is Chromium-only; don't inject a dead script elsewhere.
		if (!('chrome' in window)) return resolve(null);

		let settled = false;
		const finish = (fw: CastFramework | null) => {
			if (settled) return;
			settled = true;
			resolve(fw);
		};

		w.__onGCastApiAvailable = (available) => {
			const framework = castWindow().cast?.framework;
			const chrome = castWindow().chrome?.cast;
			if (!available || !framework || !chrome) return finish(null);
			try {
				framework.CastContext.getInstance().setOptions({
					receiverApplicationId: chrome.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
					autoJoinPolicy: chrome.AutoJoinPolicy.ORIGIN_SCOPED
				});
				finish(framework);
			} catch {
				finish(null);
			}
		};

		const script = document.createElement('script');
		script.src = SDK_URL;
		script.async = true;
		script.onerror = () => finish(null);
		document.head.appendChild(script);
		// Guard against the availability callback never firing.
		setTimeout(() => finish(castWindow().cast?.framework ?? null), 5000);
	});
	return frameworkPromise;
}

export function toCastState(fw: CastFramework, raw: string): CastState {
	if (raw === fw.CastState.CONNECTED) return 'connected';
	if (raw === fw.CastState.CONNECTING) return 'connecting';
	if (raw === fw.CastState.NOT_CONNECTED) return 'available';
	return 'off';
}

export interface CastMediaRequest {
	/** Absolute URL the receiver will fetch. */
	url: string;
	contentType: string;
	title?: string | null;
	/** Absolute poster URL for the receiver's now-playing screen. */
	posterUrl?: string | null;
}

/**
 * Open the device picker if needed, then send the media to the connected
 * receiver. Because the receiver fetches the URL itself, this works even when
 * the local element is playing HLS through MediaSource.
 */
export async function castMedia(fw: CastFramework, media: CastMediaRequest): Promise<void> {
	const chrome = castWindow().chrome?.cast;
	if (!chrome) return;
	const ctx = fw.CastContext.getInstance();
	if (ctx.getCastState() !== fw.CastState.CONNECTED) {
		await ctx.requestSession();
	}
	const session = ctx.getCurrentSession();
	if (!session) return;

	const info = new chrome.media.MediaInfo(media.url, media.contentType);
	const metadata = new chrome.media.GenericMediaMetadata();
	if (media.title) metadata.title = media.title;
	if (media.posterUrl) metadata.images = [new chrome.Image(media.posterUrl)];
	info.metadata = metadata;
	await session.loadMedia(new chrome.media.LoadRequest(info));
}
