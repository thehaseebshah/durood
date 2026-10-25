// Schedules a starter set of 30 daily Sunnahs, one a day from a start date, skipping days that already have one.
//   node scripts/seed-sunnahs.mjs [YYYY-MM-DD]      (default: today, Pakistan time)
// On Fly: fly ssh console -C "node scripts/seed-sunnahs.mjs"
// Hadith numbers follow the common sunnah.com numbering; editions differ, so have a scholar check the wording before production.
import { db } from '../server/db.js';
import { addSunnahs } from '../server/sunnah.js';
import { dayOf, dayNum, dayStr } from '../server/game.js';

export const SUNNAHS = [
  ['Eat with Bismillah and the right hand', 'بسم اللہ پڑھ کر دائیں ہاتھ سے کھانا', 'Say Bismillah, eat with your right hand, and eat from what is in front of you.', 'بسم اللہ پڑھیں، دائیں ہاتھ سے کھائیں اور اپنے سامنے سے کھائیں۔', 'Bukhari 5376, Muslim 2022'],
  ['Smile at your brother', 'مسکرا کر ملنا', 'Your smile in the face of your brother is charity.', 'اپنے بھائی کے سامنے مسکرانا صدقہ ہے۔', 'Tirmidhi 1956'],
  ['Be first to say salam', 'سلام میں پہل کرنا', 'Spread salam among yourselves: greet first, those you know and those you do not.', 'آپس میں سلام عام کریں: جاننے والوں اور نہ جاننے والوں سب کو پہلے سلام کریں۔', 'Muslim 54'],
  ['Use the miswak', 'مسواک کرنا', 'Clean your teeth with a miswak, especially before prayer.', 'خاص طور پر نماز سے پہلے مسواک کریں۔', 'Bukhari 887'],
  ['Right shoe first', 'جوتا پہلے دائیں پاؤں میں', 'Put on the right shoe first, and take off the left one first.', 'جوتا پہنتے وقت دایاں پہلے، اتارتے وقت بایاں پہلے۔', 'Bukhari 5856'],
  ['Drink sitting, in three breaths', 'بیٹھ کر تین سانس میں پینا', 'Drink sitting down, in three sips, breathing away from the cup.', 'بیٹھ کر پئیں، اور برتن سے ہٹ کر تین سانس میں۔', 'Muslim 2028'],
  ['Alhamdulillah when you sneeze', 'چھینک پر الحمدللہ', 'When you sneeze say Alhamdulillah; when someone else does, answer Yarhamukallah.', 'چھینک آئے تو الحمدللہ کہیں، اور دوسرا کہے تو یرحمک اللہ جواب دیں۔', 'Bukhari 6224'],
  ['The dua for leaving home', 'گھر سے نکلنے کی دعا', 'Bismillahi tawakkaltu ‘ala Allah, wa la hawla wa la quwwata illa billah.', 'بِسْمِ اللّٰهِ تَوَكَّلْتُ عَلَى اللّٰهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللّٰهِ', 'Abu Dawud 5095'],
  ['Sleep with wudu, on your right side', 'باوضو دائیں کروٹ سونا', 'Make wudu before bed and lie down on your right side.', 'سونے سے پہلے وضو کریں اور دائیں کروٹ لیٹیں۔', 'Bukhari 247'],
  ['Ayat al-Kursi before sleep', 'سونے سے پہلے آیت الکرسی', 'Recite Ayat al-Kursi when you go to bed: a protector stays with you until morning.', 'بستر پر آیت الکرسی پڑھیں: صبح تک اللہ کی طرف سے حفاظت رہتی ہے۔', 'Bukhari 2311'],
  ['Visit someone who is ill', 'بیمار کی عیادت', 'Whoever visits the sick remains in the harvest of Paradise until he returns.', 'بیمار کی عیادت کرنے والا واپسی تک جنت کے باغ میں رہتا ہے۔', 'Muslim 2568'],
  ['Remove harm from the path', 'راستے سے تکلیف دہ چیز ہٹانا', 'Removing something harmful from the road is a branch of faith.', 'راستے سے تکلیف دہ چیز ہٹانا ایمان کا حصہ ہے۔', 'Muslim 35'],
  ['SubhanAllah wa bihamdihi, 100 times', 'سو بار سبحان اللہ وبحمدہ', 'Whoever says it a hundred times a day has his sins wiped away, even if like the foam of the sea.', 'جو دن میں سو بار کہے اس کے گناہ معاف ہو جاتے ہیں، چاہے سمندر کی جھاگ کے برابر ہوں۔', 'Bukhari 6405'],
  ['The dua for entering the masjid', 'مسجد میں داخل ہونے کی دعا', 'Allahumma iftah li abwaba rahmatik: O Allah, open for me the doors of Your mercy.', 'اَللّٰهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ', 'Muslim 713'],
  ['Two rak‘ahs on entering the masjid', 'تحیۃ المسجد', 'When you enter the masjid, pray two rak‘ahs before you sit.', 'مسجد میں داخل ہوں تو بیٹھنے سے پہلے دو رکعت پڑھیں۔', 'Bukhari 444'],
  ['The twelve sunnah rak‘ahs', 'بارہ سنت رکعتیں', 'Whoever prays twelve voluntary rak‘ahs a day, a house is built for him in Paradise.', 'جو روزانہ بارہ سنت رکعتیں پڑھے اس کے لیے جنت میں گھر بنایا جاتا ہے۔', 'Muslim 728'],
  ['Send durood often', 'کثرت سے درود', 'Whoever sends one salah upon the Prophet ﷺ, Allah sends ten upon him.', 'جو نبی ﷺ پر ایک بار درود بھیجے، اللہ اس پر دس رحمتیں بھیجتا ہے۔', 'Muslim 408'],
  ['The dua after the adhan', 'اذان کے بعد کی دعا', 'After the adhan, ask Allah for al-wasilah for the Prophet ﷺ; his intercession becomes due for you.', 'اذان کے بعد نبی ﷺ کے لیے وسیلہ کی دعا کریں؛ ان کی شفاعت واجب ہو جاتی ہے۔', 'Bukhari 614'],
  ['Make dua between adhan and iqamah', 'اذان اور اقامت کے درمیان دعا', 'A dua between the adhan and the iqamah is not turned back.', 'اذان اور اقامت کے درمیان کی دعا رد نہیں ہوتی۔', 'Tirmidhi 212'],
  ['Give a gift', 'تحفہ دینا', 'Give gifts to one another, and you will love one another.', 'ایک دوسرے کو تحفے دو، آپس میں محبت بڑھے گی۔', 'Al-Adab al-Mufrad 594'],
  ['Speak good or stay silent', 'اچھی بات کہیں یا خاموش رہیں', 'Whoever believes in Allah and the Last Day should say what is good or keep quiet.', 'جو اللہ اور آخرت پر ایمان رکھتا ہے وہ اچھی بات کہے یا خاموش رہے۔', 'Bukhari 6018'],
  ['Do not get angry', 'غصہ نہ کرنا', 'A man asked for advice; the Prophet ﷺ said, again and again: do not get angry.', 'ایک شخص نے نصیحت مانگی؛ نبی ﷺ نے بار بار فرمایا: غصہ نہ کرو۔', 'Bukhari 6116'],
  ['Praise Allah after eating', 'کھانے کے بعد الحمدللہ', 'Alhamdulillahil-ladhi at‘amani hadha wa razaqanihi min ghayri hawlin minni wa la quwwah.', 'اَلْحَمْدُ لِلّٰهِ الَّذِي أَطْعَمَنِي هٰذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ', 'Tirmidhi 3458'],
  ['Pick up a dropped morsel', 'گرا ہوا لقمہ اٹھانا', 'If a morsel falls, clean it and eat it; do not leave it for Shaytan. Waste nothing.', 'لقمہ گر جائے تو صاف کر کے کھا لیں، شیطان کے لیے نہ چھوڑیں۔ کچھ ضائع نہ کریں۔', 'Muslim 2033'],
  ['Sayyid al-Istighfar', 'سید الاستغفار', 'Say the master supplication for forgiveness in the morning and in the evening.', 'صبح اور شام سید الاستغفار پڑھیں۔', 'Bukhari 6306'],
  ['Shake hands when you meet', 'ملاقات پر مصافحہ', 'Two Muslims who meet and shake hands are forgiven before they part.', 'دو مسلمان ملیں اور مصافحہ کریں تو جدا ہونے سے پہلے ان کی مغفرت ہو جاتی ہے۔', 'Abu Dawud 5212'],
  ['Serve your mother', 'ماں کی خدمت', 'Who most deserves my good company? Your mother, your mother, your mother, then your father.', 'میرے حسنِ سلوک کا سب سے زیادہ حقدار کون؟ تمہاری ماں، تمہاری ماں، تمہاری ماں، پھر تمہارا باپ۔', 'Bukhari 5971'],
  ['Keep ties with relatives', 'صلہ رحمی', 'Whoever wants his provision increased and his life extended should keep ties with his relatives.', 'جو چاہے کہ اس کے رزق اور عمر میں برکت ہو وہ رشتہ داروں سے تعلق جوڑے۔', 'Bukhari 5986'],
  ['Feed someone', 'کھانا کھلانا', 'The best Islam: to feed others, and to greet those you know and those you do not.', 'بہترین اسلام: کھانا کھلانا اور ہر ایک کو سلام کرنا۔', 'Bukhari 12'],
  ['Be kind to animals', 'جانوروں پر رحم', 'A man gave water to a thirsty dog; Allah thanked him and forgave him. There is reward in every living being.', 'ایک شخص نے پیاسے کتے کو پانی پلایا تو اللہ نے اسے بخش دیا۔ ہر جاندار پر رحم میں اجر ہے۔', 'Bukhari 2363'],
];

// run directly: schedule them
if (import.meta.url === `file://${process.argv[1]}`) {
  const start = process.argv[2] || dayOf();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { console.error('Usage: node scripts/seed-sunnahs.mjs [YYYY-MM-DD]'); process.exit(2); }
  const taken = new Set(db.prepare('SELECT day FROM sunnahs').all().map((r) => r.day));
  const ahead = new Set(db.prepare('SELECT title_en FROM sunnahs WHERE day >= ?').all(start).map((r) => r.title_en));
  const todo = SUNNAHS.filter(([title]) => !ahead.has(title)); // running it again schedules nothing twice
  const items = [];
  for (let i = 0, d = dayNum(start); i < todo.length; d++) {
    const day = dayStr(d);
    if (taken.has(day)) continue; // never overwrite a day an admin already set
    const [title_en, title_ur, desc_en, desc_ur, source] = todo[i++];
    items.push({ day, title_en, title_ur, desc_en, desc_ur, source });
  }
  if (items.length) addSunnahs(items);
  console.log(items.length ? `Scheduled ${items.length} Sunnahs, ${items[0].day} to ${items.at(-1).day}.` : 'All of them are already scheduled.');
}
