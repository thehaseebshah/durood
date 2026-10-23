// shared pieces for the "clear" prototypes: extra strings, line icons, quest data, bottom nav
Object.assign(STR.en, { q_goal: 'Reach your daily goal', q_week: 'Weekly goal, all 7 days', q_days: 'Recite on 5 days', q_invite: 'Invite someone new', q_sunnah: 'Post today’s sunnah', q_review: 'Review 3 sunnah photos', q_lecture: 'Watch a seerah lecture',
  dq: 'Durood quests', bq: 'Bonus quests', xp: 'XP', done: 'Done', recite: 'Recite', members: 'members', nav: ['Home', 'Ranks', 'Caravan', 'Bonus', 'Me'], level: 'Level', lvl_title: 'Zakir', goalword: 'Goal', rankw: 'Rank this week', next: 'Next level' });
Object.assign(STR.ur, { q_goal: 'روزانہ ہدف پورا کریں', q_week: 'ہفتے کا ہدف، ساتوں دن', q_days: '۵ دن درود پڑھیں', q_invite: 'کسی نئے فرد کو بلائیں', q_sunnah: 'آج کی سنت پوسٹ کریں', q_review: '۳ سنت تصاویر کی تصدیق کریں', q_lecture: 'سیرت لیکچر دیکھیں',
  dq: 'درود کے مشن', bq: 'اضافی مشن', xp: 'ایکس پی', done: 'مکمل', recite: 'پڑھیں', members: 'ارکان', nav: ['ہوم', 'رینک', 'قافلہ', 'اضافی', 'میں'], level: 'درجہ', lvl_title: 'ذاکر', goalword: 'ہدف', rankw: 'اس ہفتے کا رینک', next: 'اگلا درجہ' });
const ICON = {
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  ranks: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  caravan: '<circle cx="6" cy="14" r="2.4"/><circle cx="12" cy="8" r="2.4"/><circle cx="18" cy="14" r="2.4"/><path d="M4 20h4M10 14h4M16 20h4"/>',
  bonus: '<path d="M12 3l2.4 5.6L20 9.5l-4.2 3.9L17 19l-5-3-5 3 1.2-5.6L4 9.5l5.6-.9z"/>',
  me: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
};
const icon = (n, c = 'currentColor') => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
const NAVK = ['home', 'ranks', 'caravan', 'bonus', 'me'];
const navHTML = () => `<nav class="nav">${NAVK.map((k, i) => `<span class="${i === 0 ? 'on' : ''}">${icon(k)}<em>${t('nav')[i]}</em></span>`).join('')}</nav>`;
const Q = {
  durood: [['q_goal', 425, 500, 100], ['q_week', 2310, 3500, 300], ['q_days', 5, 5, 200], ['q_invite', 0, 1, 250]],
  bonus: [['q_sunnah', 0, 1, 30], ['q_review', 0, 3, 15], ['q_lecture', 0, 1, 30]],
};
const ltr = (s) => '⁦' + s + '⁩';
const qs = (c) => Number(new URLSearchParams(location.search).get('c')) || c;
