// The one way mod/ and the plugins log, to the console of the process that runs them, under one prefix; the lint
// refuses `console` anywhere else in them. Rule 5: names, ids and error text only, never message content or the
// token. It imports only name.mts, so the main process bundles it too.
import { APP_NAME } from "../name.mts";

const PREFIX = `[${APP_NAME}]`;

export const log = {
    info: (text: string) => console.log(`${PREFIX} ${text}`),
    /** What failed; `cause`, when given, reaches the console as an object, so DevTools shows its stack. */
    error: (text: string, ...cause: unknown[]) => console.error(`${PREFIX} ${text}`, ...cause)
};
