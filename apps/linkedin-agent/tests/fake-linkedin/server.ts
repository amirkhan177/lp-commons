// A tiny stand-in for LinkedIn, for exercising the agent end to end without touching LinkedIn.
// Run: pnpm fake-linkedin, then start the agent with LINKEDIN_BASE_URL=http://localhost:4010.
// Page structure loosely mirrors LinkedIn (main > ul > li cards); real selectors can differ.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_LINKEDIN_PORT ?? 4010);

const people: { slug: string; name: string; headline: string; connected: string; experience: string[] }[] = [
  { slug: "clemens-heijman", name: "Clemens Heijman", headline: "Managing Partner at Tenet Frontier", connected: "February 12, 2024",
    experience: ["Managing Partner\nTenet Frontier · Full-time\nJan 2024 - Present · 2 yrs"] },
  { slug: "dana-whitfield", name: "Dana Whitfield", headline: "Operator in residence", connected: "June 3, 2025",
    experience: ["Operator in Residence\nNorthwind Health\nMar 2023 - Present · 3 yrs",
                 "Benchmark Partners\n4 yrs\nPrincipal\nJan 2017 - Dec 2020 · 4 yrs\nAssociate\nFull-time\nJan 2015 - Dec 2016"] },
  { slug: "sam-quill", name: "Sam Quill", headline: "PM at Hooli", connected: "May 1, 2019",
    experience: ["Product Manager\nHooli · Full-time\n2019 - Present"] },
  { slug: "trigger-checkpoint", name: "Zed Last", headline: "Visited last; triggers a security check", connected: "January 1, 2010",
    experience: [] },
];

const page = (body: string) => `<!doctype html><html><body><main>${body}</main></body></html>`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const lines = (t: string) => t.split("\n").map((l) => `<span>${esc(l)}</span><br>`).join("");

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const authed = /(?:^|;\s*)li_at=fake-session/.test(req.headers.cookie ?? "");
  const html = (code: number, body: string, headers: Record<string, string> = {}) => {
    res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", ...headers }); res.end(body);
  };
  console.log(req.method, url.pathname, authed ? "(authed)" : "");

  if (url.pathname === "/login" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const f = new URLSearchParams(body);
      // Lengths only: proves keystrokes reached the fields without printing what was typed.
      console.log(`login submitted: email ${f.get("session_key")?.length ?? 0} chars, password ${f.get("session_password")?.length ?? 0} chars`);
      html(302, "", { Location: "/feed/", "Set-Cookie": "li_at=fake-session; Path=/; HttpOnly" });
    });
    return;
  }
  if (url.pathname === "/login") {
    return html(200, page(`<h1>Sign in (FAKE LinkedIn for tests)</h1>
      <form method="post" action="/login"><input name="session_key" placeholder="Email"><br>
      <input name="session_password" type="password" placeholder="Password"><br><button>Sign in</button></form>`));
  }
  if (!authed) return html(302, "", { Location: "/login" });
  if (url.pathname.startsWith("/feed")) return html(200, page("<h1>Feed</h1>"));
  if (url.pathname === "/checkpoint/challenge/") return html(200, page("<h1>Let's do a quick security check</h1>"));
  if (url.pathname === "/mynetwork/invite-connect/connections/") {
    return html(200, page(`<ul>${people.map((p) => `<li><a href="/in/${p.slug}/">${lines(`${p.name}\n${p.headline}`)}</a>
      ${lines(`Connected on ${p.connected}\nMessage`)}</li>`).join("")}</ul>`));
  }
  const m = url.pathname.match(/^\/in\/([^/]+)\/details\/experience\/$/);
  const person = m && people.find((p) => p.slug === m[1]);
  if (person?.slug === "trigger-checkpoint") return html(302, "", { Location: "/checkpoint/challenge/" });
  if (person) {
    return html(200, page(`<section><h2>Experience</h2><ul>${person.experience.map((e) => `<li>${lines(e)}</li>`).join("")}</ul></section>`));
  }
  html(404, page("Not found"));
}).listen(PORT, () => console.log(`fake LinkedIn on http://localhost:${PORT}`));
