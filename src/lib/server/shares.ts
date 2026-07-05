export function canAccessMedia(user: App.Locals['user']): boolean {
	return user !== null;
}
