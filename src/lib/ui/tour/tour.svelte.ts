import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { comfortMode } from '$lib/ui/theme';
import { buildSteps, TOUR_VERSION, type TourRole, type TourSample, type TourStep } from './steps';

/**
 * The guided walk's state machine. Lives at module scope so the card (rendered
 * from the layout) and the nav (which glows the current stop's link) share one
 * instance, and so the tour survives the page navigations it performs itself.
 */
class Tour {
	active = $state(false);
	steps = $state<TourStep[]>([]);
	index = $state(0);

	get step(): TourStep | null {
		return this.active ? (this.steps[this.index] ?? null) : null;
	}

	get highlight(): string | null {
		return this.step?.highlight ?? null;
	}

	get count(): number {
		return this.steps.length;
	}

	start(steps: TourStep[]): void {
		if (steps.length === 0) return;
		this.steps = steps;
		this.index = 0;
		this.active = true;
	}

	async next(): Promise<void> {
		if (!this.active) return;
		if (this.index >= this.steps.length - 1) {
			await this.finish();
			return;
		}
		await this.navigateTo(this.steps[this.index + 1]);
		this.index += 1;
	}

	async back(): Promise<void> {
		if (!this.active || this.index === 0) return;
		await this.navigateTo(this.steps[this.index - 1]);
		this.index -= 1;
	}

	/**
	 * The welcome step's comfort choice. Applies instantly for the rest of the
	 * walk, and awaits the write before advancing: every tour navigation re-runs
	 * the layout load, whose effect re-syncs the store from the DB-backed user,
	 * so an unpersisted choice would be reverted at the first stop.
	 */
	async applyComfort(enabled: boolean): Promise<void> {
		comfortMode.set(enabled);
		await this.post({ action: 'comfort', enabled });
		await this.next();
	}

	skip(): void {
		this.active = false;
		void this.post({ action: 'complete', version: TOUR_VERSION });
	}

	async finish(): Promise<void> {
		this.active = false;
		await this.post({ action: 'complete', version: TOUR_VERSION });
	}

	/** Consecutive stops on the same page must not re-run a navigation. */
	private async navigateTo(target: TourStep): Promise<void> {
		const path =
			target.route === '/item/[id]' && target.params
				? resolve('/item/[id]', { id: target.params.id })
				: target.route && target.route !== '/item/[id]'
					? resolve(target.route)
					: null;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is built via resolve() just above
		if (path && path !== page.url.pathname) await goto(path);
	}

	private async post(body: Record<string, unknown>): Promise<void> {
		try {
			await fetch('/api/onboarding', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch {
			// A dropped write only means the tour may offer itself again next visit.
		}
	}
}

export const tour = new Tour();

/**
 * Find one real memory for the walk to visit, preferring a film so the clip
 * step can show itself. Returns null on an empty library, which simply drops
 * the item stops from the walk.
 */
async function pickSampleItem(): Promise<TourSample> {
	for (const type of ['video', 'photo'] as const) {
		try {
			const res = await fetch(`/api/search?q=type:${type}&limit=1`);
			if (!res.ok) continue;
			const body = (await res.json()) as { items?: Array<{ id?: string }> };
			const id = body.items?.[0]?.id;
			if (id) return { id, type };
		} catch {
			// Network hiccup: fall through and try the next type or give up.
		}
	}
	return null;
}

/** Build the role-aware walk (including a sample memory if one exists) and start it. */
export async function startGuidedTour(role: TourRole, arrivalsCount: number): Promise<void> {
	tour.start(buildSteps(role, arrivalsCount, await pickSampleItem()));
}
