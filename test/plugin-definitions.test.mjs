// @vitest-environment happy-dom
// What each plugin declares (plugins/*/index.tsx): its name, its description and its settings, as the settings modal
// shows them to the user. A change to any of these texts shows in the snapshot, to be read before it is accepted.
// Run with `pnpm test`.
import "./fake-native.mjs";

import { expect, test, vi } from "vitest";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const plugins = await Promise.all(["corrector", "autorespuesta", "dictation"].map(async name => (await import(`../plugins/${name}/index.tsx`)).default));

test("plugins: name, description and settings as the user sees them", () => {
    const shown = plugins.map(({ name, description, settings, chatBarButton, messagePopoverButton }) => ({
        name,
        description,
        buttons: { chatBox: !!chatBarButton, message: !!messagePopoverButton },
        settings: Object.fromEntries(Object.entries(settings.def).map(([key, def]) => [key, { ...def, ...def.options && { options: "a list read when the settings open" } }]))
    }));
    expect(shown).toMatchSnapshot();
});
