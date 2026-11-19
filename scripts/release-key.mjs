// The public half of the key that signs each release's executables (.github/workflows/release.yml, its secret
// RELEASE_SIGNING_KEY): the executable installs an update only with a valid ed25519 signature by it
// (scripts/repatch.mjs). Created by the owner on 2026-11-19. A new key here reaches only the executables built after
// it: older ones refuse every release signed with it, and their users reinstall by hand (README, «Install»).
export const RELEASE_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHWinepW3x8fC5kRH5aUYytilYh8msP27hLn26Cm12lY=
-----END PUBLIC KEY-----
`;
