(() => {
  let documentId = "", scheduled = false;
  const root = document.getElementById("message");
  function report() {
    if (scheduled) return;
    scheduled = true;
    const send = () => {
      if (!scheduled) return;
      scheduled = false;
      window.webkit.messageHandlers.math.postMessage({ id: documentId, height: Math.ceil(root.getBoundingClientRect().height) });
    };
    requestAnimationFrame(send);
    setTimeout(send, 50); // Inactive/offscreen WebKit may suspend animation frames.
  }
  window.renderMessage = async (html, id, fontSize, dark) => {
    documentId = id;
    document.body.className = dark ? "dark" : "";
    document.body.style.fontSize = fontSize + "px";
    root.innerHTML = html; // Only escaped, application-generated Markdown HTML.
    for (const element of root.querySelectorAll("[data-math]")) {
      const tex = element.textContent;
      try {
        katex.render(tex, element, { displayMode: element.dataset.math === "display", throwOnError: false,
          trust: false, strict: "warn", maxExpand: 1000, maxSize: 20, macros: {}, output: "htmlAndMathml" });
      } catch { element.textContent = tex; }
    }
    root.getBoundingClientRect();
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
    if (documentId === id) report();
  };
  root.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    window.webkit.messageHandlers.math.postMessage({ id: documentId, href: link.getAttribute("href") });
  });
  document.fonts.addEventListener("loadingdone", report);
  new ResizeObserver(report).observe(root);
})();
