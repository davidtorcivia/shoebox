import type { Platform } from './types';

type FeatureEnv = Record<string, string | undefined> & { FACES_ENABLED?: string };

export function facesEnabled(env: FeatureEnv): boolean {
	return env.FACES_ENABLED === '1';
}

export function platformFeatures(
	platform: Platform['name'],
	env: FeatureEnv
): Platform['features'] {
	if (platform === 'cloudflare') {
		return { ingestion: false, faces: false, serverDerivatives: false };
	}
	return { ingestion: true, faces: facesEnabled(env), serverDerivatives: true };
}
