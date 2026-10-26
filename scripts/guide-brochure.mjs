// The feature brochure: a short, designed tour of everything in Seerah Quest, printed to guide/seerah-quest-features.pdf.
//   node scripts/guide-brochure.mjs      (needs Playwright with Chromium; pictures come from guide/img, see guide-shots.mjs)
// Each page is a fixed A4 sheet drawn in HTML. The icons and badges are the app's own (public/icons.js).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { uiIcon, badgeSvg } from '../public/icons.js';
import { I18N } from '../public/i18n.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'guide');
const T = I18N.en;
const APP_URL = 'seerah-quest.fly.dev';

// ---- small drawing helpers ------------------------------------------------------------------------------------------
// two glyphs the app draws elsewhere (the header bell) or not at all (a cloud for offline), in the same monoline style
const EXTRA = {
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z"/><path d="M12 11v5M9.8 13.8L12 16l2.2-2.2"/>',
};
const ico = (name, size = 22, stroke = 1.8) => EXTRA[name]
  ? `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA[name]}</svg>`
  : uiIcon(name, size, stroke);
// a phone with a screenshot; pins are [x%, y%] spots on the screen, numbered in order
const phone = (img, { w = 230, tilt = 0, pins = [], cls = '' } = {}) => `<div class="phone ${cls}" style="--w:${w}px;--tilt:${tilt}deg">
  <div class="screen"><img src="img/${img}.jpg" alt=""><i class="island"></i>
  ${pins.map(([x, y], i) => `<b class="pin" style="left:${x}%;top:${y}%">${i + 1}</b>`).join('')}</div></div>`;
const chip = (text, tone = '') => `<span class="chipx ${tone}">${text}</span>`;
const pts = (n) => `<span class="pts">+${n}</span>`;
const sectionHead = (num, kicker, title, text, dark = false) => `<header class="shead ${dark ? 'dark' : ''}"><span class="snum">${num}</span><div><p class="kicker">${kicker}</p><h2>${title}</h2>${text ? `<p class="stext">${text}</p>` : ''}</div></header>`;
const feature = (icon, title, text, tone = '') => `<div class="feat ${tone}"><span class="fi">${ico(icon, 22, 1.9)}</span><div><b>${title}</b><p>${text}</p></div></div>`;
const legend = (items) => `<ol class="legend">${items.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ol>`;
const footer = (n, dark = false) => `<footer class="pfoot ${dark ? 'dark' : ''}"><span>${ico('star', 11, 2)} Seerah Quest · Features at a glance</span><span>${String(n).padStart(2, '0')}</span></footer>`;

// eight-point star tile, the app's one recurring motif, as a repeating background
const tile = (stroke, op) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 72 72'><g fill='none' stroke='${stroke}' stroke-opacity='${op}' stroke-width='1'><rect x='22' y='22' width='28' height='28'/><rect x='22' y='22' width='28' height='28' transform='rotate(45 36 36)'/><path d='M0 36h8M64 36h8M36 0v8M36 64v8'/></g></svg>`)}")`;

// ---- graphics ---------------------------------------------------------------------------------------------------------
const badgeRow = (codes, earned) => codes.map((c) => `<span class="bdg">${badgeSvg(c, earned.includes(c), 64)}<small>${T.badge[c][0]}</small></span>`).join('');
const titleLadder = () => `<div class="ladder">${T.titles.map((t, i) => `<div class="rung" style="--h:${26 + i * 13}px;--o:${0.35 + i * 0.065}"><i></i><small>${i + 1}</small><span>${t}</span></div>`).join('')}</div>`;
const tiers = () => [['Bronze', '#c58a52', '#7a4c22'], ['Silver', '#c9d1db', '#6b7685'], ['Gold', '#f0cf86', '#a8781e'], ['Diamond', '#9fe8ff', '#2a8fb0']]
  .map(([n, c, d], i) => `<div class="tier" style="--c:${c};--d:${d};--lift:${i * 16}px"><svg viewBox="0 0 64 72" width="58" height="66"><path d="M32 3l26 10v22c0 17-12 28-26 34C18 63 6 52 6 35V13z" fill="var(--c)" stroke="var(--d)" stroke-width="2.5"/><path d="M28 18l-6 18h9l-3 16 14-22h-9l5-12z" fill="var(--d)"/></svg><b>${n}</b></div>`).join('<i class="tarrow">›</i>');

// Qabila: everyone under you, at every level
const qabilaTree = () => {
  const n = (x, y, r, label, cls = '') => `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${r}"/>${label ? `<text x="${x}" y="${y + 4}">${label}</text>` : ''}</g>`;
  const kids = [[60, 92], [150, 92], [240, 92]], grand = [[30, 160], [80, 160], [130, 160], [170, 160], [225, 160], [265, 160]];
  const lines = [...kids.map(([x, y]) => `M150 38L${x} ${y}`), ...grand.map(([x, y], i) => `M${kids[Math.floor(i / 2)][0]} ${kids[Math.floor(i / 2)][1]}L${x} ${y}`)].join('');
  return `<svg class="tree" viewBox="0 0 380 190" width="100%"><path d="${lines}" class="tl"/>${n(150, 34, 22, 'You', 'root')}${kids.map(([x, y]) => n(x, y, 15, '', 'kid')).join('')}${grand.map(([x, y]) => n(x, y, 10, '', 'gk')).join('')}
    <text class="lvl" x="296" y="96">← invited by you</text><text class="lvl" x="296" y="164">← invited by them</text></svg>`;
};
// caravan: a named circle of members
const caravanRing = () => {
  const ppl = ['A', 'Z', 'F', 'H', 'S', 'M'];
  const dots = ppl.map((p, i) => { const a = (i / ppl.length) * Math.PI * 2 - Math.PI / 2; return `<g class="cm"><circle cx="${110 + Math.cos(a) * 70}" cy="${95 + Math.sin(a) * 70}" r="17"/><text x="${110 + Math.cos(a) * 70}" y="${100 + Math.sin(a) * 70}">${p}</text></g>`; }).join('');
  return `<svg class="ring" viewBox="0 0 220 190" width="100%"><circle cx="110" cy="95" r="70" class="rl"/>${dots}<text class="cname" x="110" y="92">Noor</text><text class="cname2" x="110" y="108">Caravan</text></svg>`;
};
// the 40-day challenge meter
const meter = () => {
  const days = [...Array(40)].map((_, i) => `<i class="${i < 7 ? 'on' : ''}"></i>`).join('');
  return `<div class="meter"><div class="mtop"><span>${ico('star', 14, 2)} 40-DAY CHALLENGE</span><span>DAY 7 OF 40</span></div>
  <div class="mbig">10 <small>crore durood</small></div><p class="msub">100,000,000 durood together in 40 days: 25 lakh a day.</p>
  <div class="mdays">${days}</div>
  <div class="mstats"><div><b>Needed today</b><span>What finishes exactly on day 40, from where we really are</span></div><div><b>Ahead or behind</b><span>An honest figure against the plan</span></div><div><b>Each crore</b><span>Celebrated, with a picture to share</span></div></div></div>`;
};

// ---- the pages --------------------------------------------------------------------------------------------------------
const pages = [];

// 1. cover
pages.push(`<section class="page night cover">
  <div class="glow g1"></div><div class="glow g2"></div>
  <div class="ctop"><span class="brand"><img src="img/icon.png" alt="">Seerah Quest</span><span class="ur">سیرت کوئسٹ</span></div>
  <p class="durood">${T.durood}</p>
  <h1>Every feature,<br><em>at a glance.</em></h1>
  <p class="clede">Durood, Sunnah and Seerah in one free app. Grow your love for Rasool Allah&nbsp;ﷺ, one day at a time, together.</p>
  <div class="cphones">${phone('intro-1', { w: 228, tilt: -8, cls: 'back' })}${phone('today', { w: 262, tilt: 3, cls: 'front' })}${phone('feed-dark', { w: 222, tilt: 9, cls: 'side' })}</div>
  <div class="cfoot"><span>${chip('Free, forever', 'gold')} ${chip('English · اردو', 'gold')} ${chip('Works offline', 'gold')}</span><span class="url">${APP_URL}</span></div>
</section>`);

// 2. at a glance
pages.push(`<section class="page cream">
  ${sectionHead('00', 'The idea in 30 seconds', 'Recite. Add it. Grow together.', 'You recite durood in your own way and add the number to the app. Everything else, from quests to caravans, is there to help the daily habit last.')}
  <div class="pillars">
    <div class="pillar p1"><span class="rank">1st</span><span class="pi">${ico('beads', 34, 1.8)}</span><b>Durood</b><p>The heart of the app. Your number for today is the first thing you see.</p></div>
    <div class="pillar p2"><span class="rank">2nd</span><span class="pi">${ico('leaf', 34, 1.8)}</span><b>Sunnah</b><p>One Sunnah a day to live, tick and share with a photo.</p></div>
    <div class="pillar p3"><span class="rank">3rd</span><span class="pi">${ico('book', 34, 1.8)}</span><b>Seerah</b><p>A lecture each week, a short quiz, and the Seerat Circles.</p></div>
  </div>
  <div class="stats">
    <div><b>10 crore</b><span>durood, the community's 40-day goal</span></div>
    <div><b>35</b><span>badges to earn</span></div>
    <div><b>2</b><span>languages, English and Urdu</span></div>
    <div><b>0</b><span>rupees. Never asks for money</span></div>
  </div>
  <h3 class="mini">Find your way: four buttons and one menu</h3>
  <div class="map">
    ${[['home', 'Today', 'Counter, quests, Sunnah, lecture, challenge'], ['feed', 'Feed', 'News, reflections, photos, milestones'], ['bars', 'Compete', 'People, leagues, caravans, cities'], ['menu', 'Browse', 'Caravan, Qabila, Me, Settings']]
      .map(([i, t, d]) => `<div class="mapc"><span>${ico(i, 26, 1.8)}</span><b>${t}</b><small>${d}</small></div>`).join('')}
  </div>
  <h3 class="mini">A day with Seerah Quest</h3>
  <div class="day">${[['beads', 'Morning', 'Recite and add your count. Your goal bar starts to fill.'], ['leaf', 'Daytime', 'Do the Sunnah of the day; tick it, share a photo.'], ['book', 'Evening', 'Watch the lecture or write a reflection. A nudge if your streak still needs today.'], ['flame', 'Midnight', 'A new day begins, Pakistan time. Your streak grows by one.']]
    .map(([i, t, d]) => `<div class="dstep"><span>${ico(i, 20, 1.9)}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
  <div class="inviteonly"><span>${ico('chain', 20, 1.9)}</span><p><b>Invite-only and honest.</b> You join with a member's username as your code. Every count is kept on a permanent record and shown as "reported by members".</p></div>
  ${footer(2)}
</section>`);

// 3. the counter
pages.push(`<section class="page light">
  ${sectionHead('01', 'Durood counter', 'Three ways to add, one tap to undo', 'After you recite, add the number. Days follow Pakistan time, and your goal bar fills as you go.')}
  <div class="split">
    <div class="pcol">${phone('today', { w: 244, pins: [[50, 33], [50, 46], [72, 63], [50, 71], [30, 81]] })}</div>
    <div>
      ${legend([['Today\'s number', 'Big and bold, rolling up as you add.'], ['Your daily goal', 'The bar fills; reach it and it bursts with a chime.'], ['Type a total, press Add', 'The main way: recite, then type how many.'], ['+100 · +500 · +1,000', 'Quick amounts that add up in the box.'], ['Count by tapping', 'A big button, one tap per durood. A buzz at every 33, a chime at 100.']])}
      <div class="cards2">
        ${feature('refresh', 'Undo', 'Added by mistake? Tap UNDO in the message, or edit today and yesterday in History.')}
        ${feature('plus', 'Add from anywhere', 'The green + at the top opens the counter on any screen.')}
        ${feature('cloud', 'No signal? No problem', 'Your durood waits safely on the phone and is sent once, by itself, when you are back online.')}
      </div>
    </div>
  </div>
  <div class="strip">${phone('tap-counter', { w: 122, cls: 'mini' })}${phone('saved-undo', { w: 122, cls: 'mini' })}${phone('add-sheet', { w: 122, cls: 'mini' })}
    <p class="stripnote"><b>Tap counter, Undo, and the + sheet.</b> Counts are on the honour system: recite for the sake of Allah and His Messenger ﷺ, not for ranking.</p></div>
  ${footer(3)}
</section>`);

// 4. the habit loop
pages.push(`<section class="page night habit">
  <div class="glow g3"></div>
  ${sectionHead('02', 'Keep the habit', 'Streaks, quests, points and badges', 'Small encouragements that make tomorrow easier than today.', true)}
  <div class="hgrid">
    <div class="hcard flame"><span class="big">${ico('flame', 44, 1.6)}<b>7</b></span><b>Day streak</b><p>Days in a row you recited. A gentle nudge if today is still empty, firmer after 6 pm.</p></div>
    <div class="hcard"><span class="big">${ico('shield', 44, 1.6)}</span><b>Streak shields</b><p>One for every 7-day streak. It saves your streak if you miss a day.</p></div>
    <div class="hcard"><span class="big">${ico('check', 44, 2)}</span><b>Daily &amp; weekly quests</b><p>Reach your goal, recite on 5 days, invite someone. Each shows the points it pays.</p></div>
  </div>
  <div class="ptsband">
    <p class="kicker">Points you earn</p>
    <div class="ptsrow">${[['1', 'each durood'], ['5×', 'streak days'], ['20', 'Sunnah tick'], ['40', 'Sunnah photo'], ['15', 'reflection'], ['150', 'lecture'], ['500', 'friend reaches 100'], ['1,000', 'teach a circle']]
      .map(([n, l]) => `<span><b>${n}</b><small>${l}</small></span>`).join('')}</div>
  </div>
  <p class="kicker center">Ten levels, from traveller to the one brought near</p>
  ${titleLadder()}
  <div class="badges">
    <div class="brow">${badgeRow(['first_step', 'd1k', 'd10k', 'd100k', 'd1m', 'streak7', 'streak30', 'streak100'], ['first_step', 'd1k', 'streak7'])}</div>
    <div class="brow">${badgeRow(['sunnah1', 'sunnah7', 'scholar1', 'circle', 'karwan7', 'qabila10', 'league_gold', 'city_champion'], ['sunnah1', 'scholar1', 'karwan7'])}</div>
    <p class="bnote">35 badges in all, from <b>First Step</b> to <b>Qabila 10M</b>. Earned ones in colour, the rest waiting in grey.</p>
  </div>
  ${footer(4, true)}
</section>`);

// 5. Sunnah and Seerah
pages.push(`<section class="page cream">
  ${sectionHead('03', 'Sunnah & Seerah', 'Live one Sunnah. Learn one lecture.', 'Under the counter on Today, every day: a Sunnah to do, the lecture of the week and a moment to reflect.')}
  <div class="trio">
    <div class="tcol">${phone('sunnah', { w: 206, tilt: -3 })}<h4>${ico('leaf', 18, 2)} Sunnah of the day</h4><p>Read it with its source, do it, tick it ${pts(20)}. Add a photo of the Sunnah itself ${pts(40)}: no faces, location removed.</p></div>
    <div class="tcol">${phone('lecture', { w: 206 })}<h4>${ico('play', 18, 2)} Lecture of the week</h4><p>Watch in the app, answer the quiz, claim ${pts(150)}. Then leave one comment ${pts(20)}.</p></div>
    <div class="tcol">${phone('feed', { w: 206, tilt: 3 })}<h4>${ico('feed', 18, 2)} The Feed</h4><p>News, reflections, photos and milestones. Like, reply, say MashaAllah, or report.</p></div>
  </div>
  <div class="flow">${[['play', 'Watch'], ['check', 'Answer'], ['star', 'Claim'], ['feed', 'Comment']].map(([i, t], k) => `<span class="fstep"><i>${ico(i, 18, 2)}</i>${t}</span>${k < 3 ? '<span class="farr">→</span>' : ''}`).join('')}</div>
  <div class="cards2 two">
    ${feature('feed', 'Daily reflection', 'One short thought a day, up to 280 characters. Plain text, shared on the Feed. ' + pts(15))}
    ${feature('seat', 'Seerat Circles', 'Find a circle to study the Seerah in person. Join ' + pts(300) + ', teach ' + pts(1000) + ' with the Circle Teacher badge.')}
  </div>
  ${footer(5)}
</section>`);

// 6. together
pages.push(`<section class="page light">
  ${sectionHead('04', 'Together', 'Your caravan and your Qabila', 'Two kinds of group. A caravan is the group you choose. Your Qabila is the family tree of everyone you brought in.')}
  <div class="duo">
    <div class="dcard">
      <p class="kicker">Caravan · کارواں</p><h3>A group you name</h3>
      ${caravanRing()}
      <ul class="ticks"><li>Create one, or search and ask to join</li><li>Invite members by username; the owner decides</li><li>See who has recited today, share milestones</li><li>A caravan streak when half recite each day</li><li>One caravan at a time</li></ul>
    </div>
    <div class="dcard green">
      <p class="kicker">Qabila · قبیلہ</p><h3>Everyone you brought in</h3>
      ${qabilaTree()}
      <ul class="ticks"><li>Your username is your invite code</li><li>Share on WhatsApp in one tap</li><li>Everyone below you, at every level, counts</li><li>${pts(500)} when someone you invited reaches 100</li><li>Its own totals, milestones and badges</li></ul>
    </div>
  </div>
  <div class="invites"><p class="kicker">Invites grow with you</p>
    <div class="eq"><span><b>10</b><small>to start</small></span><i>+</i><span><b>3</b><small>every level</small></span><i>+</i><span><b>2</b><small>each friend who recites 100</small></span><i>+</i><span><b>10</b><small>every 7-day streak</small></span></div></div>
  <div class="strip">${phone('caravan', { w: 128, cls: 'mini' })}${phone('caravan-2', { w: 128, cls: 'mini' })}${phone('qabila', { w: 128, cls: 'mini' })}${phone('qabila-2', { w: 128, cls: 'mini' })}</div>
  ${footer(6)}
</section>`);

// 7. compete
pages.push(`<section class="page night compete">
  <div class="glow g2"></div>
  ${sectionHead('05', 'Compete, kindly', 'Rankings, leagues and the 40-day challenge', 'Friendly competition, with the intention always in view: for the sake of Allah and His Messenger ﷺ.', true)}
  ${meter()}
  <div class="csplit">
    <div class="pcol">${phone('rank-people', { w: 214, tilt: -4 })}${phone('league-dark', { w: 214, tilt: 5, cls: 'overlap' })}</div>
    <div>
      <p class="kicker">Five boards</p>
      <div class="boards">${[['me', 'People', 'This week · Challenge · All time'], ['bolt', 'League', 'About 30 members at your level'], ['caravan', 'Caravans', 'Total · Average · Growth'], ['nodes', 'Qabila', 'The biggest family trees'], ['home', 'Cities', 'Which city recites most this week']]
        .map(([i, t, d]) => `<div class="board"><span>${ico(i, 18, 2)}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
      <p class="kicker">Weekly leagues: the top move up</p>
      <div class="tiers">${tiers()}</div>
    </div>
  </div>
  ${footer(7, true)}
</section>`);

// 8. made for everyone
pages.push(`<section class="page cream">
  ${sectionHead('06', 'Made for everyone', 'Your language, your light, your phone', 'Urdu and English are equal. Light and dark are both designed. It installs like an app and keeps working on a weak signal.')}
  <div class="quad">${phone('today', { w: 160 })}${phone('today-urdu', { w: 160 })}${phone('today-dark', { w: 160 })}${phone('me-dark', { w: 160 })}</div>
  <div class="qlabels"><span>English</span><span>اردو</span><span>Dark</span><span>Dark · Me</span></div>
  <div class="fgrid">
    ${feature('sidebar', 'Install as an app', 'Add it to your home screen from Chrome or Safari. No store, its own icon.')}
    ${feature('bell', 'Gentle reminders', 'A daily reminder at your time, and a note before a streak breaks.')}
    ${feature('refresh', 'Works offline', 'Opens on your last numbers; durood waits and sends itself later.')}
    ${feature('me', 'Your profile', 'A photo, a name and one line about you. Change your goal and city.')}
    ${feature('check', 'Honest numbers', 'A permanent record: every change is kept, totals can be audited.')}
    ${feature('shield', 'Your account, your call', 'Change password, log out everywhere, or delete your account.')}
  </div>
  <blockquote class="intent"><span>“</span>Recite for the sake of Allah and His Messenger ﷺ, not for ranking.<small>The intention reminder, shown under every ranking</small></blockquote>
  ${footer(8)}
</section>`);

// 9. Al-Burhan
pages.push(`<section class="page deep">
  <div class="glow g1"></div>
  ${sectionHead('07', 'Al-Burhan edition', 'Tasks, routines, murabbi and masul', 'For Al-Burhan members, the same app also carries the work of guidance and volunteering.', true)}
  <div class="split">
    <div class="pcol">${phone('tasks', { w: 250, tilt: -3 })}</div>
    <div class="bcol">
      ${feature('check', 'Tasks and routines', 'Your own, or given by your masul. Tick the circle, swipe to finish or move a deadline. Points for keeping commitments.', 'dark')}
      ${feature('chain', 'Murabbi', 'Found through the Mamulaat app. Once you both accept, they see your full report, including your mamulaat.', 'dark')}
      ${feature('me', 'Masul', 'Add them by username. They give tasks and see your progress, never your mamulaat.', 'dark')}
      ${feature('nodes', 'My people', 'For murabbis and masuls: saliks and razakars, their reports, and #team tags.', 'dark')}
      ${feature('bars', 'Majalis', 'Pick your department; majalis are ranked each week like cities.', 'dark')}
    </div>
  </div>
  <div class="majalis"><p class="kicker">Majalis from the start</p><div>${['Shabab', 'Ilm e Deen', 'Jamiaat', 'Tameeraat', 'Seerat', 'Islaah', 'Atfaal', 'Qabail', 'Aamilah'].map((m) => `<span>${m}</span>`).join('')}</div></div>
  <div class="who"><p class="kicker">Who sees what</p>
    <div class="whorow"><span><b>Your murabbi</b>everything, including mamulaat, phone and email</span><span><b>Your masul</b>tasks, routines and general progress</span><span><b>Everyone else</b>username, city, rankings and the feed</span></div></div>
  ${footer(9, true)}
</section>`);

// 10. back cover
pages.push(`<section class="page night back">
  <div class="glow g1"></div><div class="glow g3"></div>
  <p class="kicker center gold">Begin today</p>
  <h2 class="bh">Three steps to your first durood</h2>
  <div class="steps3">
    ${[['sidebar', 'Open & install', `Go to <b>${APP_URL}</b> and add it to your home screen.`], ['chain', 'Join with a code', 'Use the username of the person who invited you.'], ['beads', 'Add your durood', 'Recite, type how many, press Add. That\'s it.']]
      .map(([i, t, d], k) => `<div class="s3"><span class="s3n">${k + 1}</span><span class="s3i">${ico(i, 30, 1.8)}</span><b>${t}</b><p>${d}</p></div>`).join('')}
  </div>
  ${phone('intro-3', { w: 250, cls: 'bphone' })}
  <p class="durood small">${T.durood}</p>
  <p class="dedic">${T.dedication}</p>
  <p class="free">Seerah Quest is free and never asks you for money. Rewards are points, badges and milestones only.</p>
  <p class="url big">${APP_URL}</p>
</section>`);

// ---- styles ----------------------------------------------------------------------------------------------------------
const css = `
@font-face { font-family: 'Inter'; src: url('../public/fonts/inter-latin.woff2') format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Nastaliq'; src: url('../public/fonts/nastaliq-ur-700.woff2') format('woff2'); }
@font-face { font-family: 'Amiri'; src: url('../public/fonts/amiri-durood.woff2') format('woff2'); }
@font-face { font-family: 'Salawat'; src: url('../public/fonts/salawat.woff2') format('woff2'); unicode-range: U+FDFA; }
@page { size: 210mm 297mm; margin: 0; }
:root { --night: #0c0e2b; --night2: #1b1d4f; --gold: #f0cf86; --gold2: #d6a548; --green: #00a86b; --green-d: #00875a; --mint: #e3f6ed;
  --cream: #f7f3ea; --ink: #15172e; --soft: #5d6075; --line: #e6e0d2;
  --sig: #00a86b; --tint: #d9f3e6; --paper: #fff; --track: #e9e9ee; }
* { box-sizing: border-box; margin: 0; }
html, body { background: #555; }
body { font: 13px/1.5 'Inter', 'Salawat', system-ui, sans-serif; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; position: relative; overflow: hidden; padding: 46px 48px 0; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; }
.cream { background: var(--cream); }
.light { background: #fff; }
.night { background: var(--night) ${tile('#f0cf86', 0.07)}; color: #f4f1ea; }
.deep { background: linear-gradient(160deg, #0b4a35, #0c0e2b 65%) ; color: #f4f1ea; }
.deep::before { content: ''; position: absolute; inset: 0; background: ${tile('#22d68f', 0.06)}; }
.cream::before, .light::before { content: ''; position: absolute; right: -80px; top: -80px; width: 340px; height: 340px; background: ${tile('#00875a', 0.10)}; border-radius: 50%; -webkit-mask: radial-gradient(circle, #000 30%, transparent 70%); mask: radial-gradient(circle, #000 30%, transparent 70%); }
.glow { position: absolute; border-radius: 50%; filter: blur(70px); pointer-events: none; }
.g1 { width: 460px; height: 460px; background: #4b2f8a; opacity: .55; left: -140px; top: -120px; }
.g2 { width: 420px; height: 420px; background: #b5791f; opacity: .35; right: -160px; top: 260px; }
.g3 { width: 380px; height: 380px; background: #0f7a55; opacity: .35; left: 30%; bottom: -160px; }
.page > :not(.glow, .pfoot, .cfoot) { position: relative; }

/* phone */
.phone { width: var(--w); padding: calc(var(--w) * .035); border-radius: calc(var(--w) * .16); background: linear-gradient(145deg, #3a3c48, #0d0e14 40%, #24252e); box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 24px 50px -12px rgba(5,6,25,.55), 0 6px 14px rgba(5,6,25,.25); transform: rotate(var(--tilt)); flex: none; }
.screen { position: relative; border-radius: calc(var(--w) * .13); overflow: hidden; background: #fff; aspect-ratio: 390 / 844; }
.screen img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.island { position: absolute; top: 1.4%; left: 50%; width: 28%; height: 3.2%; transform: translateX(-50%); background: #0a0a0f; border-radius: 99px; }
.pin { position: absolute; transform: translate(-50%, -50%); width: 24px; height: 24px; border-radius: 50%; background: var(--gold); color: var(--night); font-size: 12px; font-weight: 800; display: grid; place-items: center; box-shadow: 0 0 0 4px rgba(240,207,134,.35), 0 3px 8px rgba(0,0,0,.3); }

/* section head */
.shead { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 26px; }
.snum { font-size: 64px; line-height: .85; font-weight: 800; letter-spacing: -.04em; color: transparent; -webkit-text-stroke: 1.6px var(--green-d); }
.shead.dark .snum { -webkit-text-stroke-color: var(--gold); }
.kicker { font-size: 10.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--green-d); margin-bottom: 4px; }
.shead.dark .kicker, .night .kicker, .deep .kicker { color: var(--gold); }
h2 { font-size: 33px; line-height: 1.08; letter-spacing: -.025em; font-weight: 800; }
.stext { font-size: 14px; color: var(--soft); margin-top: 8px; max-width: 520px; }
.shead.dark .stext { color: #b9b8cc; }
.center { text-align: center; }

/* cover */
.cover { padding-top: 40px; }
.ctop { display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; font-size: 12px; color: var(--gold); }
.brand img { width: 30px; height: 30px; border-radius: 8px; }
.ur { font-family: 'Nastaliq'; font-size: 20px; color: var(--gold); line-height: 2; }
.durood { font-family: 'Amiri', serif; direction: rtl; text-align: center; font-size: 40px; line-height: 1.9; color: var(--gold); margin: 28px 0 6px; text-shadow: 0 0 30px rgba(240,207,134,.35); }
.durood.small { font-size: 22px; margin: 18px 0 4px; }
.cover h1 { font-size: 60px; line-height: 1; letter-spacing: -.035em; font-weight: 800; text-align: center; }
.cover h1 em { font-style: normal; background: linear-gradient(90deg, var(--gold), #fff3d0, var(--gold2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.clede { text-align: center; color: #c9c7da; font-size: 15px; max-width: 460px; margin: 16px auto 0; }
.cphones { position: relative; height: 600px; margin-top: 30px; }
.cphones .phone { position: absolute; }
.cphones .back { left: 10px; top: 60px; }
.cphones .front { left: 50%; margin-left: -131px; top: 0; z-index: 2; }
.cphones .side { right: 6px; top: 80px; }
.cfoot { position: absolute; left: 48px; right: 48px; bottom: 34px; display: flex; justify-content: space-between; align-items: center; }
.chipx { display: inline-block; font-size: 11px; font-weight: 650; padding: 5px 11px; border-radius: 99px; background: #fff; color: var(--ink); border: 1px solid var(--line); }
.chipx.gold { background: rgba(240,207,134,.12); border-color: rgba(240,207,134,.45); color: var(--gold); }
.url { font-weight: 700; color: var(--gold); letter-spacing: .02em; }
.url.big { font-size: 22px; text-align: center; margin-top: 14px; }

/* glance */
.pillars { display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 14px; }
.pillar { border-radius: 22px; padding: 20px; position: relative; min-height: 190px; }
.pillar b { display: block; font-size: 22px; letter-spacing: -.02em; margin: 10px 0 4px; }
.pillar p { font-size: 12.5px; }
.pillar .rank { position: absolute; right: 16px; top: 14px; font-size: 11px; font-weight: 800; letter-spacing: .1em; opacity: .7; }
.pillar .pi { display: inline-grid; place-items: center; width: 58px; height: 58px; border-radius: 18px; }
.p1 { background: var(--night); color: #f4f1ea; } .p1 .pi { background: rgba(240,207,134,.15); color: var(--gold); } .p1 p { color: #c9c7da; }
.p2 { background: var(--green-d); color: #fff; } .p2 .pi { background: rgba(255,255,255,.16); } .p2 p { color: #d8f5e8; }
.p3 { background: #fff; border: 1px solid var(--line); } .p3 .pi { background: #fbf1d8; color: #a8781e; } .p3 p { color: var(--soft); }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); margin: 22px 0 6px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.stats div { padding: 16px 12px; border-left: 1px solid var(--line); }
.stats div:first-child { border-left: 0; padding-left: 0; }
.stats b { display: block; font-size: 30px; letter-spacing: -.03em; font-weight: 800; color: var(--green-d); }
.stats span { font-size: 11.5px; color: var(--soft); }
.mini { font-size: 15px; margin: 22px 0 12px; }
.map { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.mapc { background: #fff; border-radius: 18px; padding: 16px 14px; border: 1px solid var(--line); }
.mapc span { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: var(--mint); color: var(--green-d); margin-bottom: 8px; }
.mapc b { display: block; font-size: 15px; }
.mapc small { color: var(--soft); font-size: 11px; line-height: 1.35; display: block; margin-top: 2px; }
.inviteonly { display: flex; gap: 14px; align-items: center; margin-top: 22px; background: var(--night); color: #e8e6f5; border-radius: 18px; padding: 16px 20px; }
.inviteonly span { color: var(--gold); }
.inviteonly b { color: #fff; }

/* counter */
.split { display: grid; grid-template-columns: 290px 1fr; gap: 26px; align-items: start; }
.pcol { display: flex; justify-content: center; position: relative; }
.legend { list-style: none; padding: 0; counter-reset: l; }
.legend li { counter-increment: l; position: relative; padding: 0 0 12px 38px; }
.legend li::before { content: counter(l); position: absolute; left: 0; top: 0; width: 26px; height: 26px; border-radius: 50%; background: var(--gold); color: var(--night); font-weight: 800; font-size: 12px; display: grid; place-items: center; }
.legend b { display: block; font-size: 14px; }
.legend span { color: var(--soft); font-size: 12.5px; }
.cards2 { display: grid; gap: 10px; margin-top: 8px; }
.cards2.two { grid-template-columns: 1fr 1fr; margin-top: 18px; }
.feat { display: flex; gap: 12px; align-items: flex-start; background: var(--cream); border-radius: 16px; padding: 13px 14px; border: 1px solid var(--line); }
.light .feat { background: #f7f8f6; }
.cream .feat { background: #fff; }
.feat .fi { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--mint); color: var(--green-d); }
.feat b { font-size: 13.5px; }
.feat p { font-size: 12px; color: var(--soft); line-height: 1.45; margin-top: 2px; }
.feat.dark { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.12); }
.feat.dark .fi { background: rgba(34,214,143,.15); color: #3fe3a0; }
.feat.dark p { color: #b9c4c0; }
.pts { display: inline-block; font-weight: 750; font-size: .9em; color: #9a6a00; background: #fff1cc; padding: 0 6px; border-radius: 6px; }
.strip { display: flex; gap: 18px; align-items: center; margin-top: 26px; padding: 20px; background: linear-gradient(120deg, var(--mint), #f4efe2); border-radius: 24px; }
.stripnote { font-size: 12.5px; color: var(--soft); }
.stripnote b { color: var(--ink); display: block; font-size: 14px; margin-bottom: 4px; }

/* habit */
.hgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.hcard { background: rgba(255,255,255,.06); border: 1px solid rgba(240,207,134,.2); border-radius: 20px; padding: 18px; }
.hcard .big { display: flex; align-items: center; gap: 6px; color: var(--gold); height: 50px; }
.hcard .big b { font-size: 40px; font-weight: 800; letter-spacing: -.03em; color: #fff; }
.hcard > b { display: block; font-size: 15px; margin: 6px 0 3px; }
.hcard p { font-size: 12px; color: #b9b8cc; }
.flame .big { color: #ff9f43; }
.ptsband { margin: 18px 0 18px; background: linear-gradient(90deg, rgba(240,207,134,.16), rgba(240,207,134,.04)); border-radius: 18px; padding: 14px 18px; }
.ptsrow { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.ptsrow span { text-align: center; }
.ptsrow b { display: block; font-size: 19px; color: var(--gold); font-weight: 800; }
.ptsrow small { font-size: 10px; color: #c9c7da; line-height: 1.2; display: block; }
.ladder { display: flex; align-items: flex-end; gap: 6px; height: 200px; margin: 10px 0 20px; }
.rung { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.rung i { width: 100%; height: var(--h); border-radius: 8px 8px 3px 3px; background: linear-gradient(180deg, rgba(240,207,134,var(--o)), rgba(240,207,134,.08)); border: 1px solid rgba(240,207,134,.35); order: 2; }
.rung small { order: 1; font-size: 10px; color: var(--gold); font-weight: 800; margin-bottom: 3px; }
.rung span { order: 3; font-size: 10px; font-weight: 650; margin-top: 5px; color: #e8e6f5; }
.badges { --ink: #15172e; --line: #a9a7bd; background: #fff; color: var(--ink); border-radius: 22px; padding: 18px 16px 14px; }
.brow { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; margin-bottom: 6px; }
.bdg { display: flex; flex-direction: column; align-items: center; text-align: center; }
.bdg small { font-size: 9.5px; font-weight: 650; line-height: 1.2; margin-top: 2px; }
.bnote { font-size: 11.5px; color: var(--soft); text-align: center; margin-top: 4px; }

/* sunnah & seerah */
.trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.tcol { display: flex; flex-direction: column; align-items: center; }
.tcol h4 { display: flex; align-items: center; gap: 6px; font-size: 14.5px; margin: 18px 0 4px; color: var(--green-d); }
.tcol p { font-size: 12px; color: var(--soft); text-align: center; }
.flow { display: flex; justify-content: center; align-items: center; gap: 10px; margin: 20px 0 0; }
.fstep { display: inline-flex; align-items: center; gap: 8px; background: var(--night); color: #fff; font-weight: 650; padding: 8px 16px 8px 8px; border-radius: 99px; font-size: 13px; }
.fstep i { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(240,207,134,.18); color: var(--gold); }
.farr { color: var(--gold2); font-weight: 800; font-size: 18px; }

/* together */
.duo { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.dcard { background: var(--cream); border-radius: 22px; padding: 18px 20px; }
.dcard h3 { font-size: 20px; letter-spacing: -.02em; }
.dcard.green { background: var(--night); color: #f4f1ea; }
.dcard.green .kicker { color: var(--gold); }
.ring, .tree { display: block; height: 170px; margin: 8px 0; }
.ring .rl { fill: none; stroke: var(--green-d); stroke-width: 1.5; stroke-dasharray: 4 5; }
.ring .cm circle { fill: var(--green-d); stroke: var(--cream); stroke-width: 3; }
.ring .cm text { fill: #fff; font: 700 13px Inter; text-anchor: middle; }
.ring .cname { font: 800 16px Inter; fill: var(--ink); text-anchor: middle; }
.ring .cname2 { font: 600 11px Inter; fill: var(--soft); text-anchor: middle; }
.tree .tl { stroke: rgba(240,207,134,.5); stroke-width: 1.5; fill: none; }
.tree .root circle { fill: var(--gold); } .tree .root text { font: 800 12px Inter; fill: var(--night); text-anchor: middle; }
.tree .kid circle { fill: #2a2d6e; stroke: var(--gold); stroke-width: 1.5; }
.tree .gk circle { fill: #1c1f55; stroke: rgba(240,207,134,.6); stroke-width: 1.2; }
.tree .lvl { font: 600 10px Inter; fill: #9a98b5; text-anchor: start; }
.ticks { list-style: none; padding: 0; font-size: 12px; }
.ticks li { position: relative; padding-left: 20px; margin-bottom: 4px; }
.ticks li::before { content: '✓'; position: absolute; left: 0; color: var(--green-d); font-weight: 800; }
.dcard.green .ticks li::before { color: var(--gold); }
.dcard.green .ticks { color: #d6d4e6; }
.invites { margin-top: 16px; }
.eq { display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 12px 20px; }
.eq span { text-align: center; }
.eq b { display: block; font-size: 26px; font-weight: 800; color: var(--green-d); letter-spacing: -.03em; }
.eq small { font-size: 10.5px; color: var(--soft); }
.eq i { font-style: normal; font-size: 22px; color: var(--gold2); font-weight: 800; }
.light .strip { justify-content: center; padding: 18px; }

/* compete */
.meter { background: linear-gradient(135deg, rgba(240,207,134,.16), rgba(255,255,255,.03)); border: 1px solid rgba(240,207,134,.3); border-radius: 22px; padding: 18px 22px; }
.mtop { display: flex; justify-content: space-between; font-size: 10.5px; font-weight: 800; letter-spacing: .14em; color: var(--gold); }
.mtop span { display: flex; gap: 6px; align-items: center; }
.mbig { font-size: 52px; font-weight: 800; letter-spacing: -.04em; line-height: 1.05; margin-top: 4px; }
.mbig small { font-size: 18px; font-weight: 600; color: var(--gold); letter-spacing: 0; }
.msub { color: #c9c7da; font-size: 12.5px; }
.mdays { display: grid; grid-template-columns: repeat(40, 1fr); gap: 3px; margin: 12px 0; }
.mdays i { height: 16px; border-radius: 3px; background: rgba(255,255,255,.1); }
.mdays i.on { background: linear-gradient(180deg, #3fe3a0, var(--green)); }
.mstats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.mstats b { display: block; font-size: 13px; }
.mstats span { font-size: 11px; color: #b9b8cc; }
.csplit { display: grid; grid-template-columns: 300px 1fr; gap: 22px; margin-top: 22px; }
.csplit .pcol { height: 560px; }
.csplit .pcol .phone { position: absolute; left: 0; top: 0; }
.csplit .pcol .overlap { left: 88px; top: 70px; }
.boards { display: grid; gap: 7px; margin-bottom: 18px; }
.board { display: grid; grid-template-columns: 34px 80px 1fr; align-items: center; background: rgba(255,255,255,.06); border-radius: 12px; padding: 8px 12px; }
.board span { color: var(--gold); display: grid; }
.board b { font-size: 13px; }
.board small { color: #b9b8cc; font-size: 11px; }
.tiers { display: flex; align-items: flex-end; gap: 6px; padding-top: 56px; }
.tier { display: flex; flex-direction: column; align-items: center; transform: translateY(calc(var(--lift) * -1)); }
.tier b { font-size: 11px; color: var(--c); margin-top: 3px; }
.tarrow { font-style: normal; color: rgba(240,207,134,.6); font-size: 20px; font-weight: 800; padding-bottom: 24px; }

/* everyone */
.quad { display: flex; justify-content: space-between; }
.qlabels { display: flex; justify-content: space-between; margin: 10px 0 20px; }
.qlabels span { width: 160px; text-align: center; font-weight: 700; font-size: 12px; color: var(--green-d); }
.fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

/* al-burhan */
.bcol { display: grid; gap: 9px; }
.who { margin-top: 22px; }
.whorow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.whorow span { background: rgba(255,255,255,.07); border: 1px solid rgba(34,214,143,.25); border-radius: 14px; padding: 12px 14px; font-size: 11.5px; color: #b9c4c0; }
.whorow b { display: block; color: #fff; font-size: 13px; margin-bottom: 2px; }

/* back */
.back { text-align: center; padding-top: 60px; }
.gold { color: var(--gold) !important; }
.bh { font-size: 38px; margin: 6px 0 28px; }
.steps3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: left; }
.s3 { background: rgba(255,255,255,.06); border: 1px solid rgba(240,207,134,.25); border-radius: 22px; padding: 20px; position: relative; }
.s3n { position: absolute; right: 16px; top: 8px; font-size: 44px; font-weight: 800; color: transparent; -webkit-text-stroke: 1.2px rgba(240,207,134,.6); }
.s3i { display: inline-grid; place-items: center; width: 54px; height: 54px; border-radius: 16px; background: rgba(240,207,134,.14); color: var(--gold); margin-bottom: 10px; }
.s3 b { display: block; font-size: 16px; }
.s3 p { font-size: 12px; color: #c9c7da; margin-top: 3px; }
.bphone { margin: 30px auto 0; }
.dedic { color: #d9d7e8; font-size: 13px; max-width: 470px; margin: 0 auto; }
.free { color: #9a98b5; font-size: 11.5px; margin-top: 8px; }

.day { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; position: relative; }
.day::before { content: ''; position: absolute; left: 22px; right: 22px; top: 21px; height: 2px; background: linear-gradient(90deg, var(--gold2), var(--green-d)); }
.dstep { position: relative; padding-right: 12px; }
.dstep span { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--cream); border: 2px solid var(--green-d); color: var(--green-d); margin-bottom: 8px; }
.dstep:first-child span { border-color: var(--gold2); color: #a8781e; }
.dstep b { display: block; font-size: 13.5px; }
.dstep small { display: block; font-size: 11.5px; color: var(--soft); line-height: 1.4; }
.intent { margin-top: 26px; background: var(--night) ${tile('#f0cf86', 0.08)}; color: #fff; border-radius: 22px; padding: 22px 28px 20px 72px; font-size: 19px; font-weight: 700; letter-spacing: -.01em; line-height: 1.35; position: relative; }
.intent span { position: absolute; left: 22px; top: 6px; font-size: 64px; color: var(--gold); font-family: Georgia, serif; }
.intent small { display: block; font-size: 11px; font-weight: 600; color: var(--gold); letter-spacing: .08em; text-transform: uppercase; margin-top: 8px; }
.majalis { margin-top: 22px; }
.majalis div { display: flex; flex-wrap: wrap; gap: 7px; }
.majalis span { font-size: 12px; font-weight: 650; padding: 6px 13px; border-radius: 99px; background: rgba(34,214,143,.12); border: 1px solid rgba(34,214,143,.35); color: #bff5dc; }

/* page footer */
.pfoot { position: absolute; left: 48px; right: 48px; bottom: 22px; display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; color: #9a98a8; letter-spacing: .06em; }
.pfoot span:first-child { display: flex; gap: 6px; align-items: center; }
.pfoot.dark { color: #77759a; }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Seerah Quest · Features at a glance</title><style>${css}</style></head><body>${pages.join('\n')}</body></html>`;
fs.writeFileSync(path.join(out, 'brochure.html'), html);
console.log('wrote guide/brochure.html');

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + path.join(out, 'brochure.html'), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: path.join(out, 'seerah-quest-features.pdf'), printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log('printed guide/seerah-quest-features.pdf');
