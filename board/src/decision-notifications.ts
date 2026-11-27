/** Shared, read-only notifications for every board header. */
export const NOTIFICATION_TAG = '<script defer src="/board/notifications.js"></script>';
export const NOTIFICATION_JS = String.raw`(() => {
  const header = document.querySelector(location.pathname === "/board/decisions" ? ".decision-bar" : "#board-notification-header, nav.top, nav, header");
  if (!header) return;
  const style = document.createElement("style");
  style.textContent = ".decision-notifications{position:relative;margin-left:auto;z-index:40;color:var(--text,#e3eaf2)}.decision-notifications summary{cursor:pointer;white-space:nowrap}.decision-notifications .items{position:absolute;right:0;top:100%;width:min(340px,85vw);max-height:65vh;overflow:auto;background:var(--row,#132033);border:1px solid var(--rule,#22344a);padding:8px;box-shadow:0 8px 24px #0008}.decision-notifications a{display:block;padding:8px;border-bottom:1px solid var(--rule,#22344a);overflow-wrap:anywhere;white-space:normal}.decision-notifications small{display:block;color:var(--mute,#7c8fa4)}.decision-notifications b{color:var(--busy,#f3b64c)}.decision-notifications a.on{background:var(--card,#182840)}@media (min-width:1100px){body:has(.decision-notifications[open]) aside.panel{left:calc(50% - 190px)}}";
  document.head.append(style);
  const menu = document.createElement("details"); menu.className = "decision-notifications";
  const summary = document.createElement("summary"); summary.textContent = "Decisions …";
  const items = document.createElement("div"); items.className = "items";
  menu.append(summary, items); header.append(menu);
  const age = (at) => { const m = Math.max(0, Math.floor((Date.now()-Date.parse(at))/60000)); return m<60 ? m+"m" : m<1440 ? Math.floor(m/60)+"h" : Math.floor(m/1440)+"d"; };
  async function refresh() {
    try {
      const response = await fetch("/api/decisions",{cache:"no-store"});
      if (!response.ok) throw Error("unavailable");
      const data = await response.json();
      const open = data.items.filter(x=>x.state==="pending");
      summary.textContent = "Decisions "; const badge = document.createElement("b"); badge.textContent = String(open.length); summary.append(badge);
      const links = open.map(x=>{
        const link = document.createElement("a");
        const inbox = "/board/decisions?ray="+encodeURIComponent(x.ray)+"&id="+encodeURIComponent(x.id);
        link.href = x.card ? "/board/p/"+encodeURIComponent(x.ray)+"?decision="+encodeURIComponent(x.id) : inbox;
        link.textContent = x.ray+" · "+x.decision.title;
        // On a project page the decision opens in the page's modal instead of leaving the page (owner 26 Nov).
        link.addEventListener("click", e=>{ if (window.__openDecision && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window.__openDecision(x.ray, x.id); for (const l of items.querySelectorAll("a")) l.classList.toggle("on", l===link); } });
        const detail = document.createElement("small"); detail.textContent = age(x.decision.createdAt)+" · "+(x.card ? x.card.text : "No linked card"); link.append(detail);
        return link;
      });
      items.replaceChildren(...links);
      if (!links.length) items.textContent = "No open decisions";
    } catch { summary.textContent = "Decisions ?"; items.textContent = "Notifications unavailable"; }
  }
  // Owner 27 Nov: the list stays open while decisions are worked in the modal; a click elsewhere on the page closes it.
  document.addEventListener("click", e=>{if (!menu.contains(e.target) && !(e.target.closest && e.target.closest("aside.panel, dialog"))) menu.open=false;});
  document.addEventListener("decision-answered", refresh);
  menu.addEventListener("toggle",()=>{if(menu.open)refresh();});
  refresh(); setInterval(refresh, 5000);
})();`;
