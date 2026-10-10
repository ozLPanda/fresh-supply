const test = require("node:test");
const assert = require("node:assert/strict");
const { isLocalUrl, allowPopup } = require("../src/navigation.cjs");
const origin = "http://127.0.0.1:18084";

test("local invoice blank previews and PDF blobs can open from the authenticated app", () => {
  assert.equal(
    allowPopup("about:blank", origin + "/admin/orders/1", origin),
    true,
  );
  assert.equal(
    allowPopup(
      "blob:" + origin + "/invoice",
      origin + "/admin/orders/1",
      origin,
    ),
    true,
  );
  assert.equal(isLocalUrl(origin + "/api/orders/1/invoice", origin), true);
});

test("popups cannot open files, code URLs, other origins or credentialed URLs", () => {
  for (const url of [
    "file:///private/data",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://external.example/",
    "http://127.0.0.1:18085/",
    "http://user:pass@127.0.0.1:18084/",
  ]) {
    assert.equal(allowPopup(url, origin + "/admin", origin), false);
  }
  assert.equal(
    allowPopup("about:blank", "https://external.example/", origin),
    false,
  );
});
