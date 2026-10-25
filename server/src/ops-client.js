// BookerBob error reporter: window errors, unhandled rejections and /api responses >= 500 go to
// /api/ops/client-error. No query strings, no wallet addresses, no commitments: the server scrubs again.
;(function () {
  var sent = 0
  var release = (function () {
    var s = document.querySelector('script[type="module"][src]')
    return s ? String(s.getAttribute("src")).split("/").pop() : "dev"
  })()
  var clean = function (v, max) {
    return String(v == null ? "" : v)
      .replace(/\?[^\s"')]*/g, "?…")
      .replace(/\b[GCSM][A-Z2-7]{55}\b/g, "<addr>")
      .replace(/\b(0x)?[0-9a-f]{32,}\b/gi, "<hex>")
      .replace(/\b\d{20,}\b/g, "<num>")
      .slice(0, max || 500)
  }
  var origFetch = window.fetch
  var report = function (kind, message, stack) {
    if (sent >= 20) return // per page load
    sent++
    try {
      var body = JSON.stringify({ kind: kind, message: clean(message), stack: stack ? clean(stack, 4000) : undefined, path: location.pathname + location.hash.split("?")[0].replace(/\/[^/]{40,}/g, "/…"), release: release })
      origFetch.call(window, "/api/ops/client-error", { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true }).catch(function () {})
    } catch (e) {}
  }
  window.addEventListener("error", function (e) {
    report("error", e.message || "error", e.error && e.error.stack)
  })
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason || {}
    report("unhandledrejection", r.message || r, r.stack)
  })
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || ""
    var p = origFetch.apply(this, arguments)
    if (/^(\/|https?:\/\/[^/]*\/)api\//.test(url) && url.indexOf("/api/ops/") < 0) {
      p.then(function (r) {
        if (r.status >= 500) report("api " + r.status, (init && init.method ? init.method : "GET") + " " + url.split("?")[0].replace(/^https?:\/\/[^/]*/, ""))
      }, function (err) {
        report("api network", "fetch failed " + url.split("?")[0].replace(/^https?:\/\/[^/]*/, ""), err && err.stack)
      })
    }
    return p
  }
})()
