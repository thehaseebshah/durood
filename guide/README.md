# Seerah Quest Guide

Beginner tutorials for members, as a small website (`guide/*.html`) and one PDF (`guide/seerah-quest-guide.pdf`).
A separate, designed 10-page tour of every feature is `guide/seerah-quest-features.pdf`, drawn by `scripts/guide-brochure.mjs` (edit the pages there; it uses the app's own icons and badges).
Open `guide/index.html` in a browser to read it; it is plain HTML and CSS with no build step to view.

## Edit a tutorial

Write in `guide/src/<name>.html`, never in the generated `guide/*.html`. The first line of each file holds its title, a one-line summary and the reading time:

```html
<!-- title: Add your durood | summary: Type a number, tap a preset or count by tapping. | time: 3 min -->
```

Building blocks: `<ol class="steps">` with an `<li>` per step (`<li class="pic">` puts a screenshot beside the step), `<figure class="shot">` for a phone picture (`.wide` for a computer one, `<div class="pair">` for two side by side), `<span class="ui">Add</span>` for a button's label, and `<div class="tip">`, `<div class="note">` or `<div class="warn">` with a `<b>` heading for callouts.
The order of tutorials and their parts is the `PARTS` list at the top of `scripts/guide-build.mjs`.

## Rebuild

```bash
npm run guide          # the HTML pages and print.html
npm run guide:pdf      # the same, plus the PDF (needs Playwright with Chromium)
npm run guide:shots    # retake every screenshot in guide/img from the current app (Playwright)
npm run guide:brochure # the designed 10-page feature tour, guide/seerah-quest-features.pdf (Playwright)
```

`guide:shots` starts the app on a throwaway database, fills it with a made-up community (a week of durood, two caravans, a lecture, news, reflections, tasks) and photographs each screen on a 390 px phone. Retake the pictures after a change to a screen, then rebuild the PDF.

## Publish

The `guide` folder is a static site: serve it from any static host (for example GitHub Pages with the folder as the source), or copy it next to the app.
