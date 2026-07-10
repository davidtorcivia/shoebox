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
	| '/favorites'
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
	| 'favorites'
	| 'people'
	| 'albums'
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
				(sample ? ' Tap any picture to step inside it. Let us look at one together.' : '')
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
				title: 'Every photo has its own page.',
				body: 'Here is the picture up close, with its date, its story, and the people in it. Everything on this page belongs to this one memory. The next few steps show what you can do here.'
			},
			{
				id: 'save',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="save"]'],
				eyebrow: 'Saving',
				title: 'Keep what you love.',
				body: 'Tap the heart to save a moment to your own collection. It stays saved just for you, ready whenever you want to visit it again.'
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
				body: 'Write a memory in the box, or record a voice memory just above it. Who was there? What was the day like? The stories matter as much as the pictures.'
			},
			{
				id: 'people-row',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="people-row"]'],
				eyebrow: 'People',
				title: 'Who is in the picture?',
				body: 'The people in this photo appear here. Tap a face to visit their page and see every moment they are part of.'
			}
		);

		if (uploader) {
			steps.push({
				id: 'edit',
				...itemStop,
				highlight: null,
				spot: ['[data-tour="edit"]'],
				eyebrow: 'Editing',
				title: 'Fix the details.',
				body: editor
					? 'Open Edit metadata to correct the title, the date, the place, or to tag the people in the picture. Tidy details keep the whole collection easy to find.'
					: 'On anything you upload, open Edit metadata to fix the title, the date, the place, or the people in it. Tidy details keep the whole collection easy to find.'
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
			id: 'favorites',
			route: '/favorites',
			highlight: null,
			spot: ['[data-tour="share-saved"]'],
			eyebrow: 'Saved Moments',
			title: 'Your own collection.',
			body: 'Every moment you save gathers here. Once you have saved a few, the Share button sends your whole collection to someone with a single link.'
		},
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
			body: 'Freshly added photos rest here for a quick look before they join the timeline. You decide what goes in.'
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
