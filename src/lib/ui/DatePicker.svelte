<script lang="ts">
	import { itemDateFrom, type DatePrecision, type ItemDate } from '$lib/domain/dates';

	interface Props {
		value?: ItemDate;
	}

	let { value = $bindable({ dateStart: null, dateEnd: null, precision: 'unknown' }) }: Props =
		$props();

	let precision = $state<DatePrecision>(value.precision);
	let day = $state(value.dateStart ?? '');
	let year = $state(value.dateStart?.slice(0, 4) ?? '');
	let month = $state(value.dateStart?.slice(5, 7) ?? '01');
	let yearEnd = $state(value.dateEnd?.slice(0, 4) ?? '');

	$effect(() => {
		try {
			if (precision === 'day') value = itemDateFrom({ precision, day });
			else if (precision === 'month') {
				value = itemDateFrom({ precision, year: Number(year), month: Number(month) });
			} else if (precision === 'year') value = itemDateFrom({ precision, year: Number(year) });
			else if (precision === 'range') {
				value = itemDateFrom({ precision, year: Number(year), yearEnd: Number(yearEnd) });
			} else value = itemDateFrom({ precision: 'unknown' });
		} catch {
			value = { dateStart: null, dateEnd: null, precision: 'unknown' };
		}
	});
</script>

<fieldset>
	<legend>Date</legend>
	<div class="row">
		<label>
			<span>Precision</span>
			<select bind:value={precision}>
				<option value="unknown">Unknown</option>
				<option value="day">Day</option>
				<option value="month">Month</option>
				<option value="year">Year</option>
				<option value="range">Range</option>
			</select>
		</label>

		{#if precision === 'day'}
			<label>
				<span>Day</span>
				<input type="date" bind:value={day} />
			</label>
		{:else if precision === 'month'}
			<label>
				<span>Year</span>
				<input type="number" min="1" inputmode="numeric" bind:value={year} />
			</label>
			<label>
				<span>Month</span>
				<select bind:value={month}>
					{#each Array.from({ length: 12 }, (_, i) => i + 1) as m}
						<option value={String(m).padStart(2, '0')}>{m}</option>
					{/each}
				</select>
			</label>
		{:else if precision === 'year'}
			<label>
				<span>Year</span>
				<input type="number" min="1" inputmode="numeric" bind:value={year} />
			</label>
		{:else if precision === 'range'}
			<label>
				<span>Start</span>
				<input type="number" min="1" inputmode="numeric" bind:value={year} />
			</label>
			<label>
				<span>End</span>
				<input type="number" min="1" inputmode="numeric" bind:value={yearEnd} />
			</label>
		{/if}
	</div>
</fieldset>

<style>
	fieldset {
		border: 0;
		margin: 0 0 1rem;
	}

	legend,
	span {
		display: block;
		margin-bottom: 0.4rem;
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.72rem;
		opacity: 0.85;
	}

	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.8rem;
	}

	input,
	select {
		width: 100%;
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		padding: 0.6rem 0.8rem;
		font-family: var(--font-serif);
		font-size: 1rem;
	}

	:global(html.light) input,
	:global(html.light) select {
		background: color-mix(in srgb, var(--ink) 8%, transparent);
	}
</style>

