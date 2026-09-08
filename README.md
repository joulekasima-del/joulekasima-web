# Joule Kasima — Starter Site

A minimal, static personal brand site: coaching, digital products, and creative work.
No build step — plain HTML/CSS/JS, so it deploys to Vercel as-is.

## Files
- `index.html` — page structure only, references text via `data-i18n="section.field"` attributes
- `content.js` — **all page text lives here**, in English and Thai, organized by section. This is the file to edit when you want to change wording.
- `styles.css` — all styling (colors/fonts as CSS variables at the top)
- `script.js` — mobile nav toggle, footer year, contact form handler, and the EN/TH language-switching logic (reads from `content.js`)

## Editing text
Open `content.js`. Each section (hero, services, ventures, creative, about, contact) has plain English/Thai pairs, e.g.:
```js
hero: {
  headline: { en: "I build the systems...", th: "ฉันสร้างระบบ..." }
}
```
Change the text inside the quotes, save, and push — no HTML or JS knowledge needed for wording changes. Just make sure to keep the quotes and commas intact.

## Deploy with GitHub + Vercel

1. Create a new GitHub repo (e.g. `joulekasima-site`) and push these files:
   ```
   git init
   git add .
   git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/<you>/joulekasima-site.git
   git push -u origin main
   ```
2. Go to vercel.com → **Add New Project** → import the GitHub repo.
3. Framework preset: **Other** (no build command needed, output directory is the repo root).
4. Deploy — Vercel gives you a `*.vercel.app` URL immediately.
5. Once you buy **joulekasima.com** (Namecheap, Porkbun, Google Domains successor, etc.), go to your Vercel project → **Settings → Domains** → add `joulekasima.com` and follow the DNS instructions Vercel gives you (usually an A record or nameserver change at your registrar).

## Content status

Hero, Services, Ventures (Thai Talk Breaks spotlight + Journey Planner/Kraft Junction placeholders), Creative, About, and Contact copy are all finalized and in `index.html`.

## Before you launch

- [ ] Swap the `.about-photo` gradient block for a real `<img>` of you
- [ ] Point the footer Instagram link and email to your real accounts
- [ ] Wire up the contact form to an actual email service — the current one is a visual demo only. Easiest no-backend options: [Formspree](https://formspree.io) or [Resend](https://resend.com) (both have simple HTML form integrations)
- [ ] Add a favicon and social preview image (`og:image`) in the `<head>`
- [ ] Double-check the Thai Talk Breaks and Jot It Down Telegram links still work
- [ ] Update Journey Planner / Kraft Junction copy once those are ready to reveal

## Customizing the look

All colors, fonts, and spacing tokens live at the top of `styles.css` under `:root`. Change `--amber` to shift the accent color, or swap the Google Fonts link in `index.html` to change typefaces.
