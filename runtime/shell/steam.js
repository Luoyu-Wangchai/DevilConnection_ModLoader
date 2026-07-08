import { init } from 'steamworks.js';

const gameId = 3054820;

export function initSteam() {
	return init(gameId);
}
