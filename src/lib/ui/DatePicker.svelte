<script lang="ts">
	import {
		daysInMonth,
		itemDateFrom,
		MONTHS_LONG,
		type DatePrecision,
		type ItemDate
	} from '$lib/domain/dates';

	interface Props {
		value?: ItemDate;
	}

	type BoundaryPrecision = 'day' | 'month' | 'year';

	let { value = $bindable({ dateStart: null, dateEnd: null, precision: 'unknown' }) }: Props =
		$props();

	let precision = $state<DatePrecision>(value.precision);
	let day = $state(value.dateStart ?? '');
	let year = $state(value.dateStart?.slice(0, 4) ?? '');
	let month = $state(value.dateStart?.slice(5, 7) ?? '01');
	let rangeStartPrecision = $state<BoundaryPrecision>(boundaryPrecision(value.dateStart, 'start'));
	let rangeEndPrecision = $state<BoundaryPrecision>(boundaryPrecision(value.dateEnd, 'end'));
	let rangeStartDay = $state(value.dateStart ?? '');
	let rangeStartYear = $state(value.dateStart?.slice(0, 4) ?? '');
	let rangeStartMonth = $state(value.dateStart?.slice(5, 7) ?? '01');
	let rangeEndDay = $state(value.dateEnd ?? '');
	let rangeEndYear = $state(value.dateEnd?.slice(0, 4) ?? '');
	let rangeEndMonth = $state(value.dateEnd?.slice(5, 7) ?? '12');
	let lastPrecision = $state<DatePrecision>('unknown');
	// The last value this picker itself produced. Lets the sync effect tell an
	// external update (a different item loaded, or a parent resetting the field)
	// apart from our own writes, so it re-hydrates the editing state instead of
	// clobbering the parent's value back to stale internal state — the bug that
	// made saved dates/precision silently revert to "unknown".
	let emitted = $state<ItemDate>(value);

	function sameDate(a: ItemDate, b: ItemDate): boolean {
		return a.precision === b.precision && a.dateStart === b.dateStart && a.dateEnd === b.dateEnd;
	}

	function computeValue(): ItemDate {
		try {
			if (precision === 'day') return itemDateFrom({ precision, day });
			if (precision === 'month')
				return itemDateFrom({ precision, year: Number(year), month: Number(month) });
			if (precision === 'year') return itemDateFrom({ precision, year: Number(year) });
			if (precision === 'range')
				return itemDateFrom({ precision, start: boundaryDate('start'), end: boundaryDate('end') });
			return itemDateFrom({ precision: 'unknown' });
		} catch {
			return { dateStart: null, dateEnd: null, precision: 'unknown' };
		}
	}

	function hydrate(v: ItemDate): void {
		precision = v.precision;
		day = v.dateStart ?? '';
		year = v.dateStart?.slice(0, 4) ?? '';
		month = v.dateStart?.slice(5, 7) ?? '01';
		rangeStartPrecision = boundaryPrecision(v.dateStart, 'start');
		rangeEndPrecision = boundaryPrecision(v.dateEnd, 'end');
		rangeStartDay = v.dateStart ?? '';
		rangeStartYear = v.dateStart?.slice(0, 4) ?? '';
		rangeStartMonth = v.dateStart?.slice(5, 7) ?? '01';
		rangeEndDay = v.dateEnd ?? '';
		rangeEndYear = v.dateEnd?.slice(0, 4) ?? '';
		rangeEndMonth = v.dateEnd?.slice(5, 7) ?? '12';
		lastPrecision = v.precision;
	}

	// Absorb external value changes: a value we didn't emit means the parent set
	// it (new item, reset), so rebuild the editing state from it.
	$effect(() => {
		if (!sameDate(value, emitted)) {
			hydrate(value);
			emitted = value;
		}
	});

	// Emit the value derived from the internal editing state on user changes.
	$effect(() => {
		if (precision !== lastPrecision) {
			prepopulatePrecision(precision);
			lastPrecision = precision;
		}
		const next = computeValue();
		if (!sameDate(next, emitted)) {
			emitted = next;
			value = next;
		}
	});

	function boundaryPrecision(date: string | null, side: 'start' | 'end'): BoundaryPrecision {
		if (!date) return 'year';
		const [, mm, dd] = date.split('-');
		if (side === 'start') {
			if (mm === '01' && dd === '01') return 'year';
			if (dd === '01') return 'month';
			return 'day';
		}
		if (mm === '12' && dd === '31') return 'year';
		const yearPart = Number(date.slice(0, 4));
		const monthPart = Number(mm);
		if (Number.isInteger(yearPart) && Number.isInteger(monthPart)) {
			const last = String(daysInMonth(yearPart, monthPart)).padStart(2, '0');
			if (dd === last) return 'month';
		}
		return 'day';
	}

	function boundaryDate(side: 'start' | 'end'): string {
		const boundary =
			side === 'start'
				? {
						precision: rangeStartPrecision,
						day: rangeStartDay,
						year: rangeStartYear,
						month: rangeStartMonth
					}
				: {
						precision: rangeEndPrecision,
						day: rangeEndDay,
						year: rangeEndYear,
						month: rangeEndMonth
					};

		if (boundary.precision === 'day') return boundary.day;
		const yearPart = Number(boundary.year);
		const monthPart = Number(boundary.month);
		if (!Number.isInteger(yearPart) || yearPart <= 0) return '';
		if (boundary.precision === 'year') return `${yearPart}-${side === 'start' ? '01-01' : '12-31'}`;
		if (!Number.isInteger(monthPart) || monthPart < 1 || monthPart > 12) return '';
		const dayPart = side === 'start' ? 1 : daysInMonth(yearPart, monthPart);
		return `${yearPart}-${boundary.month}-${String(dayPart).padStart(2, '0')}`;
	}

	function stepYear(current: string, delta: number): string {
		const base = Number(current) || new Date().getFullYear();
		return String(Math.max(1, base + delta));
	}

	function prepopulatePrecision(nextPrecision: DatePrecision): void {
		const now = new Date();
		const currentYear = String(now.getFullYear());
		const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

		if (nextPrecision === 'month') {
			if (!year) year = currentYear;
			if (!month) month = currentMonth;
		} else if (nextPrecision === 'year') {
			if (!year) year = currentYear;
		} else if (nextPrecision === 'range') {
			if (!rangeStartYear) rangeStartYear = currentYear;
			if (!rangeEndYear) rangeEndYear = currentYear;
			if (!rangeStartMonth) rangeStartMonth = currentMonth;
			if (!rangeEndMonth) rangeEndMonth = currentMonth;
		}
	}
</script>

<div class="date-field" role="group" aria-labelledby="date-field-label">
	<span id="date-field-label" class="date-label">Date</span>
	<div class="controls" data-mode={precision}>
		<label class="control mode">
			<span>Type</span>
			<select bind:value={precision}>
				<option value="unknown">Unknown</option>
				<option value="day">Exact day</option>
				<option value="month">Month</option>
				<option value="year">Year</option>
				<option value="range">Estimate</option>
			</select>
		</label>

		{#if precision === 'day'}
			<label class="control">
				<span>Day</span>
				<input type="date" bind:value={day} />
			</label>
		{:else if precision === 'month'}
			<label class="control year">
				<span>Year</span>
				<div class="year-box">
					<button
						type="button"
						aria-label="Previous year"
						onclick={() => (year = stepYear(year, -1))}
					>
						-
					</button>
					<input type="number" min="1" inputmode="numeric" bind:value={year} />
					<button type="button" aria-label="Next year" onclick={() => (year = stepYear(year, 1))}>
						+
					</button>
				</div>
			</label>
			<label class="control">
				<span>Month</span>
				<select bind:value={month}>
					{#each MONTHS_LONG as name, index (name)}
						<option value={String(index + 1).padStart(2, '0')}>{name}</option>
					{/each}
				</select>
			</label>
		{:else if precision === 'year'}
			<label class="control year">
				<span>Year</span>
				<div class="year-box">
					<button
						type="button"
						aria-label="Previous year"
						onclick={() => (year = stepYear(year, -1))}
					>
						-
					</button>
					<input type="number" min="1" inputmode="numeric" bind:value={year} />
					<button type="button" aria-label="Next year" onclick={() => (year = stepYear(year, 1))}>
						+
					</button>
				</div>
			</label>
		{:else if precision === 'range'}
			<div class="range-copy">Estimate between earliest and latest possible dates</div>
			<div class="range-row">
				<div class="boundary">
					<span>Earliest possible</span>
					<select bind:value={rangeStartPrecision} aria-label="Earliest date precision">
						<option value="year">Year</option>
						<option value="month">Month</option>
						<option value="day">Day</option>
					</select>
					{#if rangeStartPrecision === 'day'}
						<input type="date" bind:value={rangeStartDay} aria-label="Earliest possible day" />
					{:else}
						<div class="year-box">
							<button
								type="button"
								aria-label="Previous earliest year"
								onclick={() => (rangeStartYear = stepYear(rangeStartYear, -1))}
							>
								-
							</button>
							<input
								type="number"
								min="1"
								inputmode="numeric"
								bind:value={rangeStartYear}
								aria-label="Earliest possible year"
							/>
							<button
								type="button"
								aria-label="Next earliest year"
								onclick={() => (rangeStartYear = stepYear(rangeStartYear, 1))}
							>
								+
							</button>
						</div>
						{#if rangeStartPrecision === 'month'}
							<select bind:value={rangeStartMonth} aria-label="Earliest possible month">
								{#each MONTHS_LONG as name, index (name)}
									<option value={String(index + 1).padStart(2, '0')}>{name}</option>
								{/each}
							</select>
						{/if}
					{/if}
				</div>

				<div class="boundary">
					<span>Latest possible</span>
					<select bind:value={rangeEndPrecision} aria-label="Latest date precision">
						<option value="year">Year</option>
						<option value="month">Month</option>
						<option value="day">Day</option>
					</select>
					{#if rangeEndPrecision === 'day'}
						<input type="date" bind:value={rangeEndDay} aria-label="Latest possible day" />
					{:else}
						<div class="year-box">
							<button
								type="button"
								aria-label="Previous latest year"
								onclick={() => (rangeEndYear = stepYear(rangeEndYear, -1))}
							>
								-
							</button>
							<input
								type="number"
								min="1"
								inputmode="numeric"
								bind:value={rangeEndYear}
								aria-label="Latest possible year"
							/>
							<button
								type="button"
								aria-label="Next latest year"
								onclick={() => (rangeEndYear = stepYear(rangeEndYear, 1))}
							>
								+
							</button>
						</div>
						{#if rangeEndPrecision === 'month'}
							<select bind:value={rangeEndMonth} aria-label="Latest possible month">
								{#each MONTHS_LONG as name, index (name)}
									<option value={String(index + 1).padStart(2, '0')}>{name}</option>
								{/each}
							</select>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.date-field {
		container-type: inline-size;
		display: grid;
		grid-template-columns: 132px minmax(0, 1fr);
		gap: 14px;
		align-items: start;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.date-label,
	span,
	.range-copy {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.date-label {
		padding: 15px 0 0;
		opacity: 0.78;
	}

	.controls {
		display: grid;
		grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr);
		gap: 10px;
		min-width: 0;
	}

	.controls[data-mode='range'],
	.controls[data-mode='year'],
	.controls[data-mode='unknown'] {
		grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr);
	}

	.control,
	.boundary {
		display: grid;
		gap: 6px;
		min-width: 0;
	}

	.control span,
	.boundary span,
	.range-copy {
		opacity: 0.76;
	}

	input,
	select,
	.year-box button {
		min-height: 48px;
		border: 0;
		background-color: color-mix(in srgb, var(--cream) 13%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 17px;
	}

	input,
	select {
		width: 100%;
		padding: 10px 12px;
	}

	select {
		cursor: pointer;
		/* Room for the global chevron so it doesn't overlap the value. */
		padding-right: 2.2em;
	}

	input[type='number'] {
		appearance: textfield;
		text-align: center;
	}

	input[type='number']::-webkit-outer-spin-button,
	input[type='number']::-webkit-inner-spin-button {
		appearance: none;
		margin: 0;
	}

	.year-box {
		display: grid;
		grid-template-columns: 48px minmax(72px, 1fr) 48px;
		gap: 1px;
		background: color-mix(in srgb, var(--cream) 18%, transparent);
	}

	.year-box input,
	.year-box button {
		background: color-mix(in srgb, var(--cream) 12%, transparent);
	}

	.year-box button {
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 18px;
		font-weight: 800;
	}

	.range-copy {
		grid-column: 1 / -1;
		margin-top: 2px;
		padding: 14px 16px;
		background: color-mix(in srgb, var(--cream) 8%, transparent);
	}

	.controls[data-mode='unknown'] .mode,
	.controls[data-mode='year'] .mode {
		max-width: 360px;
	}

	.range-row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	@media (max-width: 760px) {
		.date-field,
		.controls,
		.range-row {
			grid-template-columns: 1fr;
		}

		.date-label {
			padding: 0;
		}
	}

	@container (max-width: 560px) {
		.date-field,
		.controls,
		.range-row {
			grid-template-columns: 1fr;
		}

		.date-label {
			padding: 0;
		}

		.range-copy {
			line-height: 1.25;
		}
	}
</style>
