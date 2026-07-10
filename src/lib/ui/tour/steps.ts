/**
 * The guided walk: a short, role-aware tour of the app for new arrivals. Steps
 * live here as plain data so filtering is unit-testable and the card component
 * stays dumb. Bump TOUR_VERSION to invite everyone through an updated walk.
 */
export const TOUR_VERSION = 1;

export type TourRole = 'owner' | 'admin' | 'editor' | 'uploader' | 'user';

// Client-side copy of the server's ROLE_RANK ($lib/server/roles cannot be
// imported into the client graph). Kept in parity by steps.test.ts.
export const TOUR_ROLE_RANK: Record<TourRole, number> = {
	user: 0,
	uploader: 1,
	editor: 2,
	admin: 3,
	owner: 4
};

export type TourRoute =
	| '/'
	| '/people'
	| '/albums'
	| '/search'
	| '/upload'
	| '/arrivals'
	| '/admin'
	| '/profile';

export type TourStep = {
	id:
		| 'welcome'
		| 'timeline'
		| 'people'
		| 'albums'
		| 'search'
		| 'upload'
		| 'arrivals'
		| 'admin'
		| 'profile';
	/** Where this stop lives; null stays on the current page (welcome). */
	route: TourRoute | null;
	/** Nav element to glow while this step is showing; matches data-tour keys. */
	highlight: string | null;
	eyebrow: string;
	title: string;
	body: string;
	/** On narrow screens, add the "behind the menu button" hint line. */
	menuHint?: boolean;
};

const WELCOME: TourStep = {
	id: 'welcome',
	route: null,
	highlight: null,
	eyebrow: 'Welcome',
	title: 'Welcome to Shoebox.',
	body: 'This is your family’s home for photos, films, and the stories behind them. Before we look around, one quick question. Would you like larger text and calmer motion? You can change this later on your Profile page.'
};

const WALK: Array<TourStep & { minRole?: TourRole; needsArrivals?: boolean }> = [
	{
		id: 'timeline',
		route: '/',
		highlight: 'timeline',
		menuHint: true,
		eyebrow: 'The Timeline',
		title: 'Every memory, in order.',
		body: 'This is the front door. Every photo and film lives here, from the oldest to the newest. Scroll gently and drift through the years.'
	},
	{
		id: 'people',
		route: '/people',
		highlight: 'people',
		menuHint: true,
		eyebrow: 'People',
		title: 'Everyone has a page.',
		body: 'Pick a face to see their photos, their films, and how they fit into the family.'
	},
	{
		id: 'albums',
		route: '/albums',
		highlight: 'albums',
		menuHint: true,
		eyebrow: 'Albums',
		title: 'Moments that belong together.',
		body: 'Albums gather related memories in one place. A wedding, a holiday, a whole summer at the lake.'
	},
	{
		id: 'search',
		route: '/search',
		highlight: 'search',
		menuHint: true,
		eyebrow: 'Search',
		title: 'Looking for something?',
		body: 'Type a name, a place, or a year, and Shoebox will find it for you.'
	},
	{
		id: 'upload',
		route: '/upload',
		highlight: 'upload',
		menuHint: true,
		minRole: 'uploader',
		eyebrow: 'Upload',
		title: 'Add your own.',
		body: 'Bring in photos and films from your phone or computer. They join the collection for the whole family to enjoy.'
	},
	{
		id: 'arrivals',
		route: '/arrivals',
		highlight: 'arrivals',
		menuHint: true,
		minRole: 'editor',
		needsArrivals: true,
		eyebrow: 'Arrivals',
		title: 'New things wait here.',
		body: 'Freshly added photos rest here for a quick look before they join the timeline. You decide what goes in.'
	},
	{
		id: 'admin',
		route: '/admin',
		highlight: 'admin',
		menuHint: true,
		minRole: 'admin',
		eyebrow: 'Admin',
		title: 'The keys to the house.',
		body: 'Invite family members, manage accounts, and keep everything running smoothly.'
	},
	{
		id: 'profile',
		route: '/profile',
		highlight: 'profile',
		menuHint: true,
		eyebrow: 'Your Profile',
		title: 'This page is yours.',
		body: 'Change your picture, your colors, and your comfort settings here. You can play this tour again from this page whenever you like. Enjoy the memories.'
	}
];

export function buildSteps(role: TourRole, arrivalsCount: number): TourStep[] {
	const rank = TOUR_ROLE_RANK[role] ?? 0;
	const walk = WALK.filter((step) => {
		if (step.minRole && rank < TOUR_ROLE_RANK[step.minRole]) return false;
		// Mirror the nav: the Arrivals entry hides itself when the queue is empty.
		if (step.needsArrivals && arrivalsCount <= 0) return false;
		return true;
	}).map(({ minRole: _minRole, needsArrivals: _needsArrivals, ...step }) => step);
	return [WELCOME, ...walk];
}
