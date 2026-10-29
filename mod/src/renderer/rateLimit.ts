// Rule 3: `send`, `edit`, `delete` and `react` can't be used to flood a chat, whoever calls them; all count against one limit.
const MIN_SEND_INTERVAL_MS = 5000;
const MAX_SENDS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

export function rateLimiter() {
    let sendTimes: { chatId: string; at: number; }[] = [];
    return {
        /** Why a new action in that chat has to wait, or null if it can go. */
        limited(chatId: string, now = Date.now()) {
            sendTimes = sendTimes.filter(s => now - s.at <= HOUR_MS);
            if (sendTimes.length >= MAX_SENDS_PER_HOUR) return `Límite de ritmo: ya hay ${MAX_SENDS_PER_HOUR} envíos, ediciones, borrados o reacciones en la última hora`;
            const last = sendTimes.findLast(s => s.chatId === chatId);
            if (last && now - last.at < MIN_SEND_INTERVAL_MS) return "Límite de ritmo: espera unos segundos entre acciones en el mismo chat";
            return null;
        },
        /** Counts an action that is about to be published. */
        record(chatId: string, now = Date.now()) {
            sendTimes.push({ chatId, at: now });
        }
    };
}
