// Lint and format rules for mod/, plugins/, scripts/ and test/, run by `pnpm lint` (`pnpm fix` applies the fixable
// ones).
import stylistic from "@stylistic/eslint-plugin";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["mod/dist/", "node_modules/", "coverage/", "reports/", ".stryker-tmp/"] },
    ...tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx,mts,mjs}"],
        linterOptions: { reportUnusedDisableDirectives: "error" },
        plugins: {
            "@stylistic": stylistic,
            "simple-import-sort": simpleImportSort,
            "unused-imports": unusedImports
        },
        rules: {
            // Discord's modules and stores are untyped: `any` is how mod/ and plugins/ reach them.
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],

            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }],
            "@stylistic/jsx-quotes": ["error", "prefer-double"],
            "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
            "@stylistic/arrow-parens": ["error", "as-needed"],
            "@stylistic/eol-last": ["error", "always"],
            "@stylistic/no-multi-spaces": "error",
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/no-whitespace-before-property": "error",
            "@stylistic/semi": ["error", "always"],
            "@stylistic/semi-style": ["error", "last"],
            "@stylistic/space-in-parens": ["error", "never"],
            "@stylistic/block-spacing": ["error", "always"],
            "@stylistic/comma-spacing": "error",
            "@stylistic/object-curly-spacing": ["error", "always"],
            "@stylistic/spaced-comment": ["error", "always", { markers: ["!"] }],
            "@stylistic/no-extra-semi": "error",
            "@stylistic/function-call-spacing": ["error", "never"],
            "@stylistic/key-spacing": "error",
            "@stylistic/type-annotation-spacing": "error",
            "@stylistic/padding-line-between-statements": ["error",
                { blankLine: "always", prev: "import", next: "*" },
                { blankLine: "any", prev: "import", next: "import" }
            ],

            "yoda": "error",
            "eqeqeq": ["error", "always", { null: "ignore" }],
            "operator-assignment": ["error", "always"],
            "no-useless-computed-key": "error",
            "no-unneeded-ternary": ["error", { defaultAssignment: false }],
            "no-constant-condition": ["error", { checkLoops: false }],
            "no-duplicate-imports": "error",
            "no-fallthrough": "error",
            "no-cond-assign": ["error", "except-parens"],
            "no-prototype-builtins": "error",
            "no-unsafe-optional-chaining": "error",
            "prefer-const": ["error", { destructuring: "all" }],
            "prefer-spread": "error",
            "no-restricted-globals": ["error", "event", "name"],

            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
            "unused-imports/no-unused-imports": "error"
        }
    },
    {
        // Plugins reach mod/ only through @plugin-api/ and each other only through plugins/shared/. run.ts and
        // dictation/main.ts are the exceptions: they run in the main process, on Node's modules.
        files: ["plugins/**/*.{ts,tsx}"],
        ignores: ["plugins/shared/run.ts", "plugins/dictation/main.ts", "plugins/dictation/**"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [{
                    regex: "^(?!@plugin-api/[^.]|\\./[^.]|\\.\\./shared(?:/[^.]|$))",
                    message: "Plugins import only from @plugin-api/, plugins/shared/ and their own folder."
                }]
            }]
        }
    },
    {
        // The same for the Dictation plugin, which also reaches its engine, dictation/, through its pure modules.
        files: ["plugins/dictation/**/*.{ts,tsx}"],
        ignores: ["plugins/dictation/main.ts"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [{
                    regex: "^(?!@plugin-api/[^.]|\\./[^.]|\\.\\./shared(?:/[^.]|$)|\\.\\./\\.\\./dictation/src/(?:segmenter|style|vocabulary)$)",
                    message: "The Dictation plugin imports only from @plugin-api/, plugins/shared/, its own folder and dictation/'s pure modules."
                }]
            }]
        }
    },
    {
        // dictation/ is the engine, kept apart so it can leave this repo: it imports nothing from outside its folder.
        files: ["dictation/**/*.{ts,mjs}"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [{
                    regex: "^(?:\\.\\./\\.\\./|@plugin-api/|electron$)",
                    message: "dictation/ imports only its own files and Node's modules."
                }]
            }]
        }
    },
    {
        // Logs go through plugin-api/log.ts, the one place that owns their prefix and rule 5.
        files: ["mod/src/**/*.{ts,tsx}", "plugins/**/*.{ts,tsx}"],
        ignores: ["mod/src/plugin-api/log.ts"],
        rules: { "no-console": "error" }
    }
);
