function isLocalUrl(url, origin) {
  try {
    const parsed = new URL(url);
    return (
      Boolean(origin) &&
      !parsed.username &&
      !parsed.password &&
      ["http:", "blob:"].includes(parsed.protocol) &&
      parsed.origin === new URL(origin).origin
    );
  } catch {
    return false;
  }
}

function allowPopup(url, sourceUrl, origin) {
  // Invoice previews open a blank window during the user click, then navigate
  // it to their local PDF blob after the authenticated request finishes.
  return (
    isLocalUrl(url, origin) ||
    (url === "about:blank" && isLocalUrl(sourceUrl, origin))
  );
}

module.exports = { isLocalUrl, allowPopup };
