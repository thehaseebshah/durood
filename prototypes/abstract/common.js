// Shared mock data + strings for the UI prototypes (not wired to the real app).
const L = new URLSearchParams(location.search).get('lang') === 'ur' ? 'ur' : 'en';
document.documentElement.lang = L;
document.documentElement.dir = L === 'ur' ? 'rtl' : 'ltr';
const DATA = {
  user: 'ali_khan', level: 3, today: 425, goal: 500, week: 2310, total: 18420, streak: 6, shields: 1, rank: 7,
  members: 14, lit: 9, caravanTotal: 96300, national: 12400000, target: 100000000, xp: 1450, next: 1600,
  arabic: 'اللّٰهُمَّ صَلِّ عَلٰى مُحَمَّدٍ وَعَلٰى اٰلِ مُحَمَّدٍ',
};
const STR = {
  en: { app: 'Durood Qafila', durood: 'Durood', today: 'Today', week: 'This week', total: 'All time', streak: 'day streak', rank: 'Weekly rank', caravan: 'Caravan', members: 'members',
    sunnah: 'Sunnah', seerah: 'Seerah', tap: 'Tap to recite', goal: 'Daily goal', quests: 'Quests', level: 'Level', title: 'Zakir', recited: 'recited today', of: 'of', home: 'Home', ranks: 'Ranks',
    bonus: 'Bonus', me: 'Me', post: 'Post today’s sunnah', watch: 'Watch a lecture', loop: 'Loop', stop: 'Stop', lit: 'recited today', national: 'The whole Qafila', add: 'Add to my count', you: 'you',
    titles: ['Musafir', 'Talib', 'Zakir', 'Mushtaq', 'Muhib', 'Aashiq'], page: 'Page', folio: 'This week', centre: 'Durood', beds: 'Bonus', your: 'Your' },
  ur: { app: 'درود قافلہ', durood: 'درود', today: 'آج', week: 'اس ہفتے', total: 'کل', streak: 'دن کا سلسلہ', rank: 'ہفتہ وار رینک', caravan: 'قافلہ', members: 'ارکان',
    sunnah: 'سنت', seerah: 'سیرت', tap: 'پڑھنے کے لیے ٹیپ کریں', goal: 'روزانہ ہدف', quests: 'مشن', level: 'درجہ', title: 'ذاکر', recited: 'آج پڑھ چکے', of: 'از', home: 'ہوم', ranks: 'رینک',
    bonus: 'اضافی', me: 'میں', post: 'آج کی سنت پوسٹ کریں', watch: 'ایک لیکچر دیکھیں', loop: 'دور', stop: 'مقام', lit: 'آج پڑھ چکے', national: 'پورا قافلہ', add: 'میری گنتی میں جمع کریں', you: 'آپ',
    titles: ['مسافر', 'طالب', 'ذاکر', 'مشتاق', 'محب', 'عاشق'], page: 'صفحہ', folio: 'اس ہفتے', centre: 'درود', beds: 'اضافی', your: 'آپ کا' },
};
const t = (k) => STR[L][k];
const fmt = (x) => Number(x).toLocaleString('en-US');
const FONT_UR = "'Noto Nastaliq Urdu','Noto Naskh Arabic',serif";
const FONT_AR = "'Noto Naskh Arabic','Amiri',serif";
document.head.insertAdjacentHTML('beforeend', '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&family=Noto+Nastaliq+Urdu:wght@400;700&display=swap">');
