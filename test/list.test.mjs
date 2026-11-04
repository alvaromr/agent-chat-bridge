// Bounded index access (plugins/corrector/list.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { elementAt } from "../plugins/corrector/list.ts";

test("elementAt returns the element at an index inside the list, null included", () => {
    assert.equal(elementAt(["a", "b"], 1), "b");
    assert.equal(elementAt([null], 0), null);
});

test("elementAt fails loudly outside the list instead of returning undefined", () => {
    for (const index of [-1, 2, 0.5])
        assert.throws(() => elementAt(["a", "b"], index), new RangeError(`Index ${index} outside a list of 2`));
});
