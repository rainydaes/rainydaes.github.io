// ---- settings: change these to match your GitHub repo ----
const OWNER = "rainydaes";
const REPO = "rainydaes.github.io";
const BRANCH = "main";
// -----------------------------------------------------------

const TOKEN_KEY = "dev-token";
const THEME_KEY = "theme";

// ---------- storage (can fail in private windows) ----------
function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {}
}
function load(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// ---------- light / dark ----------
// Runs right away (this script is in <head>) so there's no flash of the wrong theme.
const savedTheme = load(THEME_KEY);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

// ---------- GitHub API (dev mode only) ----------
const apiUrl = (path) =>
  `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function ghGet(path, token) {
  const res = await fetch(`${apiUrl(path)}?ref=${BRANCH}&t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (res.status === 404) return { posts: [], sha: null };
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const json = await res.json();
  return { posts: JSON.parse(fromB64(json.content)), sha: json.sha };
}

async function ghPut(path, token, posts, sha, message) {
  const body = {
    message,
    branch: BRANCH,
    content: toB64(JSON.stringify(posts, null, 2) + "\n"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl(path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new Error("GitHub was still catching up, try again in a few seconds");
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
}

// ---------- password -> token (made by encrypt-token.js) ----------
async function decryptToken(password) {
  const res = await fetch(`secret.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("no-secret");
  const s = await res.json();
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(s.salt), iterations: s.iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(s.iv) }, key, bytes(s.data));
  return new TextDecoder().decode(plain);
}

// ---------- rendering ----------
// Set when this browser is unlocked: { token, path, page }. null for visitors.
let dev = null;

function stampNow() {
  return new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function render(posts) {
  const el = document.getElementById("posts");
  el.textContent = "";
  if (!posts.length) {
    el.innerHTML = '<p class="muted">nothing here yet.</p>';
    return;
  }
  posts
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date)) // newest first
    .forEach((p) => el.append(postElement(p)));
}

function postElement(p) {
  const article = document.createElement("article");
  const time = document.createElement("time");
  time.dateTime = p.date;
  time.textContent = p.stamp;
  const text = document.createElement("div");
  text.className = "text";
  text.textContent = p.text;
  article.append(time, text);
  if (dev) article.append(postActions(p, text));
  return article;
}

// ---------- dev mode ----------
// Re-read the latest file from GitHub, apply a change, write it back, re-render.
async function savePosts(change, message) {
  const { posts, sha } = await ghGet(dev.path, dev.token);
  const updated = change(posts);
  await ghPut(dev.path, dev.token, updated, sha, message);
  render(updated);
}

function postActions(p, text) {
  const row = document.createElement("div");
  row.className = "row actions";
  row.innerHTML = `
    <button type="button">edit</button>
    <button type="button">delete</button>
    <span class="status muted"></span>`;
  const [editButton, deleteButton] = row.querySelectorAll("button");
  const status = row.querySelector(".status");

  editButton.onclick = () => {
    const form = document.createElement("form");
    form.className = "edit";
    form.innerHTML = `
      <textarea aria-label="edit post"></textarea>
      <div class="row">
        <button type="submit">save</button>
        <button type="button" class="cancel">cancel</button>
        <span class="status muted"></span>
      </div>`;
    const textarea = form.querySelector("textarea");
    const formStatus = form.querySelector(".status");
    const buttons = form.querySelectorAll("button");
    textarea.value = p.text;

    text.replaceWith(form);
    row.hidden = true;
    textarea.focus();

    form.querySelector(".cancel").onclick = () => {
      form.replaceWith(text);
      row.hidden = false;
    };
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit();
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const newText = textarea.value.trim();
      if (!newText) {
        formStatus.textContent = "that's empty. use delete instead.";
        return;
      }
      buttons.forEach((b) => (b.disabled = true));
      formStatus.textContent = "saving…";
      try {
        await savePosts((posts) => {
          const i = posts.findIndex((x) => x.date === p.date);
          if (i === -1) throw new Error("that post isn't there anymore");
          posts[i] = { ...posts[i], text: newText };
          return posts;
        }, `edit post on ${dev.page}`);
      } catch (err) {
        formStatus.textContent = `didn't save: ${err.message}.`;
        buttons.forEach((b) => (b.disabled = false));
      }
    };
  };

  deleteButton.onclick = async () => {
    if (!confirm("delete this post?")) return;
    editButton.disabled = deleteButton.disabled = true;
    status.textContent = "deleting…";
    try {
      await savePosts(
        (posts) => posts.filter((x) => x.date !== p.date),
        `delete post on ${dev.page}`
      );
    } catch (err) {
      status.textContent = `didn't delete: ${err.message}.`;
      editButton.disabled = deleteButton.disabled = false;
    }
  };

  return row;
}

// Compose box at the top of the page.
function setUpCompose() {
  const form = document.createElement("form");
  form.id = "compose";
  form.innerHTML = `
    <textarea placeholder="write something…" aria-label="new post"></textarea>
    <div class="row">
      <button type="submit">post</button>
      <span class="status muted"></span>
      <span class="spacer"></span>
      <button type="button" class="lock">lock</button>
    </div>`;
  document.querySelector("main").prepend(form);

  const textarea = form.querySelector("textarea");
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".status");

  form.querySelector(".lock").onclick = () => {
    store(TOKEN_KEY, null);
    location.reload();
  };

  // cmd+enter / ctrl+enter posts
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    button.disabled = true;
    status.textContent = "posting…";
    try {
      const post = { date: new Date().toISOString(), stamp: stampNow(), text };
      await savePosts((posts) => [...posts, post], `post to ${dev.page}`);
      textarea.value = "";
      status.textContent = "posted. the public page updates in a minute or two.";
    } catch (err) {
      status.textContent = `didn't post: ${err.message}. your text is still here.`;
    } finally {
      button.disabled = false;
    }
  };
}

// ---------- page start ----------
document.addEventListener("DOMContentLoaded", async () => {
  const themeButton = document.getElementById("theme");
  if (themeButton) {
    themeButton.onclick = () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      store(THEME_KEY, next);
    };
  }

  const page = document.body.dataset.page;
  if (!document.getElementById("posts")) return; // homepage / dev page

  const path = `posts/${page}.json`;
  const token = load(TOKEN_KEY);

  try {
    if (token) {
      // dev mode: read straight from GitHub so you see your newest posts immediately
      dev = { token, path, page };
      setUpCompose();
      render((await ghGet(path, token)).posts);
    } else {
      const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
      render(res.ok ? await res.json() : []);
    }
  } catch (err) {
    document.getElementById("posts").innerHTML =
      '<p class="muted">couldn\'t load posts.</p>';
  }
});
