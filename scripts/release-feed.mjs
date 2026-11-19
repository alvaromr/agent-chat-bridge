// The releases on GitHub that the executable updates from (scripts/repatch.mjs): the latest one's tag, notes and
// files, and a file's bytes. The one module of scripts/ that makes requests when it runs, to GitHub only, sending
// nothing but the request.
const LATEST = "https://api.github.com/repos/alvaromr/agent-chat-bridge/releases/latest";
/** GitHub's API asks every client to name itself. */
const HEADERS = { "User-Agent": "agent-chat-bridge" };

/**
 * The latest release: its tag, its notes and its files' download URLs by name. Null when GitHub can't be reached or
 * answers otherwise, as offline, which only the log notes.
 * @returns {Promise<{ tag: string, notes: string, files: Record<string, string> } | null>}
 */
export async function latestRelease() {
    try {
        const response = await fetch(LATEST, { headers: { ...HEADERS, Accept: "application/vnd.github+json" } });
        if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
        const release = await response.json();
        return {
            tag: release.tag_name,
            notes: release.body ?? "",
            files: Object.fromEntries(release.assets.map(asset => [asset.name, asset.browser_download_url]))
        };
    } catch (err) {
        console.log(`Releases not checked: ${/** @type {Error} */ (err).message}`);
        return null;
    }
}

/** A release file's bytes, or an error when GitHub doesn't hand them over. */
export async function download(/** @type {string} */ url) {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`);
    return new Uint8Array(await response.arrayBuffer());
}
