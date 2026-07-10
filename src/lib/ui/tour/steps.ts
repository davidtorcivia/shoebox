/**
 * The guided walk: a role-aware tour of the app for new arrivals. Steps are
 * built as plain data so filtering is unit-testable and the card component
 * stays dumb. Bump TOUR_VERSION to invite everyone through an updated walk.
 *
 * When the library has at least one item, the walk detours through a real
 * memory page and demonstrates saving, reacting, memories, people, editing,
 * sharing, and clipping, each with a spotlight on the actual control.
 */
export const TOUR_VERSION = 2;

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
	| '/profile'
	| '/item/[id]';

export type TourStepId =
	| 'welcome'
	| 'timeline'
	| 'item'
	| 'save'
	| 'react'
	| 'memories'
	| 'people-row'
	| 'edit'
	| 'share'
	| 'clip'
	| 'people'
	| 'albums'
	| 'saved'
	| 'search'
	| 'upload'
	| 'arrivals'
	| 'admin'
	| 'profile';

/** A representative item the walk can visit; null when the library is empty. */
export type TourSample = { id: string; type: 'video' | 'photo' } | null;

export type TourStep = {
	id: TourStepId;
	/** Where this stop lives; null stays on the current page (welcome). */
	route: TourRoute | null;
	/** Route params, for the sample-item stop. */
	params?: { id: string };
	/** Nav element to glow while this step is showing; matches data-tour keys. */
	highlight: string | null;
	/**
	 * Selectors to spotlight, tried in order until one is visible (the fallback
	 * lets nav stops spotlight the hamburger when the menu is collapsed). When
	 * nothing matches, the whole page dims evenly behind the card.
	 */
	spot?: string[];
	/** A <details> element to open while this step is showing (edit metadata). */
	expand?: string;
	eyebrow: string;
	title: string;
	body: string;
	/** On narrow screens, add the "behind the menu button" hint line. */
	menuHint?: boolean;
};

const navSpot = (key: string): string[] => [`[data-tour="${key}"]`, '[data-tour="menu"]'];

export function buildSteps(
	role: TourRole,
	arrivalsCount: number,
	sample: TourSample = null
): TourStep[] {
	const rank = TOUR_ROLE_RANK[role] ?? 0;
	const uploader = rank >= TOUR_ROLE_RANK.uploader;
	const editor = rank >= TOUR_ROLE_RANK.editor;
	const admin = rank >= TOUR_ROLE_RANK.admin;

	const steps: TourStep[] = [
		{
			id: 'welcome',
			route: null,
			highlight: null,
			eyebrow: 'Welcome',
			title: 'Welcome to Shoebox.',
			body: 'This is your family’s home for photos, films, and the stories behind them. Before we look around, one quick question. Would you like larger text and calmer motion? You can change this later on your Profile page.'
		},
		{
			id: 'timeline',
			route: '/',
			highlight: 'timeline',
			spot: navSpot('timeline'),
			menuHint: true,
			eyebrow: 'The Timeline',
			title: 'Every memory, in order.',
			body:
				'This is the front door. Every photo and film lives here, from the oldest to the newest. Scroll gently and drift through the years.' +
				(sample ? ' Tap any moment to step inside it. Let us look at one together.' : '')
		}
	];

	if (sample) {
		const itemStop = { route: '/item/[id]' as const, params: { id: sample.id } };
		steps.push(
			{
				id: 'item',
				...itemStop,
				highlight: null,
				eyebrow: 'A Single Memory',
				title: 'Every memory has its own page.',
				body: 'Here it is up close, with its date, its story, and the people in it. Everything on this page belongs to this one moment. The next few steps show what you can do here.'
			},
			{
				id: 'save',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="save"]'],
				eyebrow: 'Saving',
				title: 'Keep what you love.',
				body: 'Tap the heart to keep this moment in Saved, your own private collection. We will visit it in a little while.'
			},
			{
				id: 'react',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="react"]'],
				eyebrow: 'Reactions',
				title: 'Leave a little warmth.',
				body: 'Tap the plus to add a small reaction. It is a quick way to let the family know this one made you smile.'
			},
			{
				id: 'memories',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="memories"]'],
				eyebrow: 'Memories',
				title: 'Tell the story behind it.',
				body: 'Write a memory in the box, or record a voice memory just above it. Who was there? What was the day like? The stories are worth keeping too.'
			},
			{
				id: 'people-row',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="people-row"]'],
				eyebrow: 'People',
				title: 'Who is in this moment?',
				body: 'The people in it appear here. Tap a name to visit their page and see every moment they are part of.'
			}
		);

		if (uploader) {
			steps.push({
				id: 'edit',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="edit"]'],
				expand: '[data-tour="edit"]',
				eyebrow: 'Editing',
				title: 'Fix the details.',
				body: editor
					? 'This form is where details get fixed. Correct the title, the date, or the place, and tag the people who appear. Tidy details keep the whole collection easy to find.'
					: 'On anything you upload, this form works the same way. Correct the title, the date, or the place, and tag the people who appear.'
			});
		}

		if (editor) {
			steps.push({
				id: 'share',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="share"]'],
				eyebrow: 'Sharing',
				title: 'Send it beyond the family.',
				body: 'Share creates a private link you can send to anyone, even without an account. You choose whether it needs a password or an expiry date.'
			});
		}

		if (sample.type === 'video') {
			steps.push({
				id: 'clip',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="clip"]'],
				eyebrow: 'Clips',
				title: 'Share just the good part.',
				body:
					'On any film, tap the scissors in the player to choose a start and an end. You can save that little piece as a small video or a moving picture.' +
					(editor ? ' You can also share the clip on its own private link.' : '')
			});
		}
	}

	steps.push(
		{
			id: 'people',
			route: '/people',
			highlight: 'people',
			spot: navSpot('people'),
			menuHint: true,
			eyebrow: 'People',
			title: 'Everyone has a page.',
			body: 'Pick a face to see their photos, their films, and how they fit into the family.'
		},
		{
			id: 'albums',
			route: '/albums',
			highlight: 'albums',
			spot: uploader ? ['[data-tour="new-album"]'] : navSpot('albums'),
			menuHint: !uploader,
			eyebrow: 'Albums',
			title: 'Moments that belong together.',
			body:
				'Albums gather related memories in one place. A wedding, a holiday, a whole summer at the lake.' +
				(uploader ? ' Tap New album to start one of your own.' : '')
		},
		{
			id: 'saved',
			route: '/albums',
			highlight: 'albums',
			spot: ['[data-tour="saved-card"]'],
			eyebrow: 'Saved',
			title: 'Your own private album.',
			body: 'The moments you save with the heart gather here, in an album only you can see. Open it any time, and share the whole collection with a single link when you want to.'
		},
		{
			id: 'search',
			route: '/search',
			highlight: 'search',
			spot: ['[data-tour="search-box"]'],
			eyebrow: 'Search',
			title: 'Looking for something?',
			body: 'Type a name, a place, or a year, and Shoebox will find it for you.'
		}
	);

	if (uploader) {
		steps.push({
			id: 'upload',
			route: '/upload',
			highlight: 'upload',
			spot: ['[data-tour="file-pick"]'],
			eyebrow: 'Upload',
			title: 'Add your own.',
			body: 'Bring in photos and films from your phone or computer. Choose them here, add a date and a title if you know them, and they join the collection for the whole family.'
		});
	}

	// Mirror the nav: the Arrivals entry hides itself when the queue is empty,
	// and review is admin-only.
	if (admin && arrivalsCount > 0) {
		steps.push({
			id: 'arrivals',
			route: '/arrivals',
			highlight: 'arrivals',
			spot: navSpot('arrivals'),
			menuHint: true,
			eyebrow: 'Arrivals',
			title: 'New things wait here.',
			body: 'Freshly added memories rest here for a quick look before they join the timeline. You decide what goes in.'
		});
	}

	if (admin) {
		steps.push({
			id: 'admin',
			route: '/admin',
			highlight: 'admin',
			spot: navSpot('admin'),
			menuHint: true,
			eyebrow: 'Admin',
			title: 'The keys to the house.',
			body: 'Invite family members, manage accounts, and keep everything running smoothly.'
		});
	}

	steps.push({
		id: 'profile',
		route: '/profile',
		highlight: 'profile',
		spot: navSpot('profile'),
		menuHint: true,
		eyebrow: 'Your Profile',
		title: 'This page is yours.',
		body: 'Change your picture, your colors, and your comfort settings here. You can play this tour again from this page whenever you like. Enjoy the memories.'
	});

	return steps;
}
