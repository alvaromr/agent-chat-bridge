// Rule 3: `send`, `edit`, `delete` and `react` can't be used to flood a chat, whoever calls them; all count against one limit.
import { MAX_SENDS_PER_HOUR, MIN_SEND_INTERVAL_MS } from "../limits.mts";

const HOUR_MS = 3_600_000;

/** Why an action has to wait, as the CLI shows it to the user. */
const TEXT = {
    perHour: `Límite de ritmo: ya hay ${MAX_SENDS_PER_HOUR} envíos, ediciones, borrados o reacciones en la última hora`,
    tooSoon: "Límite de ritmo: espera unos segundos entre acciones en el mismo chat"
} as const;

export function rateLimiter() {
    let sendTimes: { chatId: string; at: number; }[] = [];
    return {
        /** Why a new action in that chat has to wait, or null if it can go. */
        limited(chatId: string, now = Date.now()) {
            sendTimes = sendTimes.filter(s => now - s.at <= HOUR_MS);
            if (sendTimes.length >= MAX_SENDS_PER_HOUR) return TEXT.perHour;
            const last = sendTimes.findLast(s => s.chatId === chatId);
            if (last && now - last.at < MIN_SEND_INTERVAL_MS) return TEXT.tooSoon;
            return null;
        },
        /** Counts an action that is about to be published. */
        record(chatId: string, now = Date.now()) {
            sendTimes.push({ chatId, at: now });
        }
    };
}
