/** The env names the host-tools bridge program reads: the socket that hands it the turn's tools, and the one-time key it presents there. */
export const BRIDGE_SOCKET = 'ORIBOT_BRIDGE_SOCKET';
export const BRIDGE_KEY = 'ORIBOT_BRIDGE_KEY';
/** The longest first line the bridge socket reads before it gives up on a client. */
export const MAX_KEY_LINE = 256;
