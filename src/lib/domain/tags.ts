import { HOLIDAYS } from './holidays';

const HOLIDAY_LABEL = new Map(HOLIDAYS.map((holiday) => [holiday.id, holiday.label]));

function titleCase(name: string): string {
	return name.replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

/**
 * Human-facing label for a tag. Holiday tags are stored under their slug id
 * (e.g. `christmas`, `mothers-day`) so they resolve to the registry's proper
 * label; topic tags are stored lowercased, so we title-case them for display.
 */
export function tagDisplayLabel(name: string, kind: 'topic' | 'holiday'): string {
	if (kind === 'holiday') return HOLIDAY_LABEL.get(name) ?? titleCase(name.replace(/-/g, ' '));
	return titleCase(name);
}
