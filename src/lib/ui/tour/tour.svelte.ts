import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { comfortMode } from '$lib/ui/theme';
import { TOUR_VERSION, type TourStep } from './steps';

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
		const target = this.steps[this.index + 1];
		if (target.route) await goto(resolve(target.route));
		this.index += 1;
	}

	async back(): Promise<void> {
		if (!this.active || this.index === 0) return;
		const target = this.steps[this.index - 1];
		if (target.route) await goto(resolve(target.route));
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
