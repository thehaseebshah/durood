# Sunnah research: the 40 added Sunnahs (list now 70)

For scholar review. Every entry is in `scripts/seed-sunnahs.mjs` (`SUNNAHS`, entries 31 to 70).

## How this was verified, and its limits

- **sunnah.com could not be opened from the research environment (HTTP 403).** It was therefore NOT consulted directly. Two things stand in for it:
  1. The open `hadith-api` dataset (github.com/fawazahmed0/hadith-api, files fetched from `cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/{eng,ara}-{bukhari,muslim,abudawud,tirmidhi,nasai,ibnmajah,malik}.json`). It carries the sunnah.com English and Arabic texts, the sunnah.com numbering and the per-scholar gradings shown on sunnah.com (Albani, Arnaut, Zubair Ali Zai, Shakir, Maarouf, Hamid). Every text below was read in this dataset and matches the claim made in the app.
  2. Web searches with snippets from dorar.net, islamqa.org (Hanafi/hadithanswers), seekersguidance.org, muftiwp.gov.my, surahquran.com, sunnah.com search listings and abuaminaelias.com. Only the ones named in a row were actually used.
- **Numbering:** Bukhari = dataset `hadithnumber`. Muslim = dataset `arabicnumber` (the number sunnah.com shows as the main one, e.g. "2032"; sub-letters dropped). Abu Dawud, Tirmidhi: `hadithnumber`. Because sunnah.com itself was not opened, a scholar should spot-check numbers on sunnah.com; any doubt is marked **verify**.
- **Second source rule:** for Bukhari and Muslim the second source is the consensus of the Ummah on the two Sahihs. For other collections the second source is the set of independent graders shown (e.g. Albani + Arnaut + Zai) plus any web source listed.
- **Grades in the app:** Bukhari/Muslim entries carry no tag. Where graders differ (e.g. Albani sahih, Zai hasan) the lower one, "hasan", is written in the source field. Nothing weaker than hasan is used.
- **Fiqh status** is my plain-language reading (sunnah mu'akkadah / mustahabb / adab / sunnah of habit / command) and is not a fatwa. The app text claims nothing stronger than the evidence.
- Dua wordings were taken from the Arabic text in the dataset. Harakat in the Urdu field were written by hand; please proof-read them.

## The 40 new Sunnahs

| # | Title | Source (number as used) | Grade | Fiqh status | Checked in | Caveat |
|---|---|---|---|---|---|---|
| 31 | Two rak'ahs after every wudu | Bukhari 1149 (Bilal), Muslim 226 (Uthman) | Sahih | Mustahabb (Tahiyyat al-wudu) | dataset | Not in disallowed times. |
| 32 | Pray Duha after sunrise | Muslim 720, Bukhari 1178 | Sahih | Mustahabb, often called emphasised (Prophet advised Abu Hurayra never to leave it) | dataset | Two rak'ahs is the minimum quoted; not before the sun is well up. |
| 33 | Stay seated after Fajr until sunrise | Muslim 670 | Sahih | Sunnah of the Prophet's practice, mustahabb | dataset | The "reward of Hajj and Umrah" report (Tirmidhi 586) is deliberately NOT used: Albani/Shakir/Maarouf hasan, but Zubair Ali Zai and Darussalam (sunnah.com) da'if, so disputed. |
| 34 | Pray in clean shoes when you can | Bukhari 386, Muslim 555 (also Abu Dawud 652, 650 sahih) | Sahih | Permissible (mubah); some scholars call it mustahabb to differ from the Jews (Abu Dawud 652), Nawawi and Ibn Daqiq al-'Id read it as permission only | dataset; seekersguidance.org; muftiwp.gov.my al-Kafi 1235 | App text says "permitted" and adds a courtesy note. Carpeted masjids and local custom make this sensitive; Hanafi practice generally also treats clean shoes as valid but disliked in carpeted masjids by adab. Scholar to confirm whether to keep. |
| 35 | Ask Allah in the hour of the night | Muslim 757 | Sahih | Mustahabb (qiyam al-layl) | dataset | Deliberately chose the "hour" hadith, not the "Allah descends" hadith (Bukhari 1145 / Muslim 758), to avoid the attributes-of-Allah wording that the schools explain differently. |
| 36 | Walk to the masjid with wudu | Muslim 666 | Sahih | Mustahabb | dataset | Hadith is about an obligatory prayer. |
| 37 | Repeat after the mu'adhdhin | Bukhari 611, Muslim 383, Muslim 385 | Sahih | Mustahabb (some call it wajib) | dataset | The "La hawla" reply at Hayya 'ala is in Muslim 385; the existing list already has the dua after adhan. |
| 38 | Pray Istikhara before decisions | Bukhari 6382 (also 1166, 7390) | Sahih | Sunnah / mustahabb | dataset | Fath al-Bari numbering often quotes it as 1162; the dataset shows Bukhari 1162 is a different hadith (Aisha, talking after Fajr sunnah), so **verify** the number on sunnah.com. 6382 and 7390 are unaffected. |
| 39 | Straighten the rows, fill the gaps | Bukhari 723, Muslim 433 | Sahih | Sunnah mu'akkadah / highly emphasised (some say wajib) | dataset | Wording avoids the foot-touching dispute. |
| 40 | Fast on Mondays and Thursdays | Tirmidhi 747, Muslim 1162 | Tirmidhi 747: Albani sahih, Maarouf and Zai hasan -> written "hasan". Muslim 1162: Monday only (Muslim says the Thursday mention is an error). | Mustahabb | dataset | Source field lists Muslim for the Monday evidence and Tirmidhi for both days. |
| 41 | Keep your will written and ready | Bukhari 2738, Muslim 1627 | Sahih | Mustahabb; wajib to record debts/trusts owed | dataset | Not legal advice. Bequests to heirs and beyond one third are governed by inheritance law. |
| 42 | Visit the graves | Muslim 976, Muslim 975 | Sahih | Mustahabb for men; scholars differ for women | dataset | Wording is gender-neutral and only about remembering death and greeting. Nothing about seeking from the dead. |
| 43 | Eat humbly on the ground | Bukhari 5386, Bukhari 5399 (also Tirmidhi 1788 sahih) | Sahih | Sunnah of habit / adab. The app says a table is allowed. | dataset | Bukhari 5386 is "khiwan"; 5399 is "I do not eat reclining". |
| 44 | Eat with three fingers and lick them | Muslim 2032, Muslim 2034 | Sahih | Mustahabb (adab of eating) | dataset | Cutlery is not forbidden; the text only describes the Prophet's practice. |
| 45 | Never find fault with food | Bukhari 5409, Muslim 2064 | Sahih | Adab, mustahabb | dataset | |
| 46 | If you forget Bismillah when eating | Abu Dawud 3767 | Albani sahih, Arnaut sahih li-ghayrihi, Zai isnaad sahih, Hamid sahih -> written "hasan" (cautious) | Mustahabb | dataset; Tirmidhi 1858 (Shakir sahih, Maarouf hasan sahih) is a cross-reference but its text is empty in the dataset, so it is not cited (**verify**) | The Abu Dawud chain contains an unnamed woman (Umm Kulthum); graders accept it with supporting reports. |
| 47 | The dua for a new garment | Abu Dawud 4020 | Albani sahih, Arnaut and Zai hasan -> "hasan" | Mustahabb | dataset; web search (dorar.net/h/qZxJZLTu) reports Albani sahih, Arnaut hasan, Tirmidhi "hasan gharib sahih" for the Tirmidhi parallel (1767) | The Abu Nadra addition ("tubli wa yukhliful-lah") is in the same hadith but not quoted. |
| 48 | Wear white | Abu Dawud 3878 (also 4061), Tirmidhi 2810 | Albani, Arnaut sahih; Zai hasan (3878). Tirmidhi 2810: Albani sahih, Maarouf hasan sahih, Zai da'if -> "hasan" | Mustahabb | dataset | App text says other colours are fine. Tirmidhi 2810 is graded da'if by Zai, so Abu Dawud is the stronger anchor. |
| 49 | Do not refuse perfume | Bukhari 2582, Muslim 2253 (Nasai 5259 sahih) | Sahih | Mustahabb to accept | dataset | Muslim 2253 uses "rayhan" (fragrant plant, rendered "flower" in the dataset), the same meaning. Men and women have different rules on how to wear scent in public, not covered here. |
| 50 | Men: keep the garment above the ankles | Bukhari 5787, Bukhari 5783 (and 5784) | Sahih | **Scholars differ on the ruling**: haram, makruh tahrim, or makruh when without pride. Everyone agrees dragging it in arrogance is condemned (5783) and that Abu Bakr was excused (5784). | dataset | The most sensitive entry. The app text quotes the hadith and gives no ruling beyond it. The scholar may wish to soften or drop it. |
| 51 | Walk with a firm, purposeful step | Abu Dawud 4864 | Albani, Arnaut, Hamid, Zai sahih | Sunnah of habit (description of the Prophet), adab | dataset | Zai cross-references Muslim 2340 but the walking phrase is not in Muslim 2340 as dataset shows (**verify**). Quran 31:19 asks for a moderate pace; the text says "without swagger". |
| 52 | Give the full greeting of peace | Bukhari 3217, Tirmidhi 2689 | Bukhari sahih. Tirmidhi 2689: Albani and Shakir sahih, Maarouf and Zai hasan -> "hasan" | Sunnah to give and to return the greeting; replying is wajib | dataset | Abu Dawud 5195 is the same report (Albani sahih, Zai da'if) and is not cited. A web search could not find Dorar's page for it, so it rests on the dataset graders. |
| 53 | Greet children with salam | Bukhari 6247, Muslim 2168 | Sahih | Sunnah | dataset | |
| 54 | Say Jazak Allahu khayran | Tirmidhi 2035 | Tirmidhi "hasan jayyid gharib"; Albani sahih; Ibn Hibban 3413 narrates it; Zai da'if | Mustahabb | dataset; web search of Arabic dorar snippets (surahquran.com mirror of dorar) | Zai's da'if is the dissent. |
| 55 | Make dua for your brother unseen | Muslim 2732 | Sahih | Mustahabb | dataset | |
| 56 | Thank people | Abu Dawud 4811, Tirmidhi 1954 | Sahih (Albani, Arnaut, Hamid, Zai on 4811; Shakir, Albani, Zai on 1954) | Adab | dataset | |
| 57 | Be gentle in everything | Muslim 2593, Bukhari 6024 | Sahih | Adab / general virtue | dataset | Meant as the "courage with gentleness" entry. No claim about commanding the good. |
| 58 | Seek refuge in Allah when angry | Bukhari 3282 | Sahih | Mustahabb | dataset | Hadith wording is "min ash-shaytan"; "ar-rajim" is a common addition. |
| 59 | Be gentle with those who serve you | Bukhari 6038, Muslim 2309 | Sahih | Adab (the Prophet's example) | dataset | |
| 60 | Help with the housework | Bukhari 676 | Sahih | Sunnah of habit | dataset | |
| 61 | Kiss your children | Bukhari 5997, Muslim 2318 | Sahih | Mustahabb | dataset | Title kept to what the hadith says (kissing). |
| 62 | Share your cooking with neighbours | Muslim 2625 | Sahih | Mustahabb | dataset | |
| 63 | Give charity daily, even half a date | Bukhari 1417, Muslim 1016 | Sahih | Mustahabb | dataset | |
| 64 | The three Quls before sleep | Bukhari 5017 | Sahih | Sunnah | dataset | The existing list has Ayat al-Kursi (Bukhari 2311). |
| 65 | The dua on waking up | Bukhari 6312 | Sahih | Sunnah | dataset | |
| 66 | The dua for the toilet | Bukhari 142, Muslim 375 | Sahih | Sunnah (before entering) | dataset | I did not add "left foot first" or the exit dua "ghufranaka" because they were not cross-checked. |
| 67 | Shake out your bed before lying down | Bukhari 6320 | Sahih | Mustahabb | dataset | |
| 68 | The dua for travel | Muslim 1342 | Sahih | Mustahabb | dataset | Hadith describes the camel; applying it to cars and planes is the standard scholarly extension. App shows the opening portion only. |
| 69 | Mention Allah when entering home | Muslim 2018 | Sahih | Mustahabb | dataset | |
| 70 | The dua when it rains | Bukhari 1032 | Sahih | Mustahabb | dataset | |

## Rejected or not used

| Candidate | Reason |
|---|---|
| "Say 'I do not know'" | The best-attested text (Bukhari 4774, Muslim 2798) is the statement of Ibn Mas'ud, a Companion, not a report from the Prophet ﷺ. Prophetic examples of "I do not know" that I know of are in Ahmad/Hakim, not verified here. Dropped rather than labelled a Sunnah. |
| Eating together, not apart | Abu Dawud 3764 is hasan per Albani/Arnaut but da'if per Zai; Ibn Majah 3286 is mixed; Ibn Majah 3287 is da'if jiddan (Albani and al-Baqi "very daif"). Dropped. |
| Dua when looking in the mirror ("Allahumma anta hassanta khalqi...") | Not in the six books or Muwatta; I could not verify two independent gradings. |
| Two rak'ahs before Maghrib (Bukhari 625) | Sahih hadith but a well-known disagreement between the schools (Hanafi view differs). Avoided as contested. |
| Lowering the gaze (Muslim 2159) | It is a command, not a recommended Sunnah; not presented as a daily Sunnah. |
| Tirmidhi 586 reward of Hajj and Umrah for sitting after Fajr | Graded hasan by Albani, Shakir, Maarouf; da'if by Zai and Darussalam; the practice itself (Muslim 670) is used instead. |
| "Allah descends in the last third of the night" (Bukhari 1145, Muslim 758) | Authentic, but the wording touches a known difference in explaining the attributes of Allah; the neutral "hour of the night" hadith (Muslim 757) is used. |
| Fasting 'Arafah, 'Ashura, six of Shawwal, white days | Authentic but seasonal; the list is a sequence of days. Candidates for a later seasonal feature. |
| Friday ghusl and going early (Bukhari 881, Muslim 850), following the funeral (Bukhari 1325), three days each month (Bukhari 1981), cover food and drink (Bukhari 5624, Muslim 2012), pass the drink to the right (Muslim 2029), trim the nails (Bukhari 5891), do not make a person leave his seat (Bukhari 6269, Muslim 2177) | All verified sahih, kept in reserve for the next round (just to keep exactly 40). |

## Re-check of the existing 30 (entries 1 to 30)

Texts and numbers were looked up in the same dataset.

| # | Entry | Source | Verdict |
|---|---|---|---|
| 1 | Eat with Bismillah and the right hand | Bukhari 5376, Muslim 2022 | verified (Umar b. Abi Salama) |
| 2 | Smile at your brother | Tirmidhi 1956 | verified. Albani sahih, Shakir sahih, Zai hasan. Source field has no tag; consider "(hasan)". |
| 3 | Be first to say salam | Muslim 54 | verified (the text about spreading salam is Muslim 54) |
| 4 | Use the miswak | Bukhari 887 | verified |
| 5 | Right shoe first | Bukhari 5856 | **needs a closer look**: Bukhari 5856 is "do not walk in one shoe". The "right first" hadith is Bukhari 5855. Verify the number on sunnah.com and fix; the practice itself is authentic. |
| 6 | Drink sitting, in three breaths | Muslim 2028 | **needs a closer look**: Muslim 2028 covers three breaths only. The ban on drinking standing is Muslim 2024/2025, and standing is also permitted (Bukhari 5615), so "sitting" is a preference, not a rule. Suggest "Muslim 2024, 2028". |
| 7 | Alhamdulillah when you sneeze | Bukhari 6224 | verified |
| 8 | The dua for leaving home | Abu Dawud 5095 | verified. Albani sahih, Hamid sahih, Zai hasan. Source field has no tag; consider "(hasan)". |
| 9 | Sleep with wudu, on your right side | Bukhari 247 | verified |
| 10 | Ayat al-Kursi before sleep | Bukhari 2311 | verified (Abu Hurayra and the captured thief) |
| 11 | Visit someone who is ill | Muslim 2568 | verified |
| 12 | Remove harm from the path | Muslim 35 | verified (also Tirmidhi 1958 sahih) |
| 13 | SubhanAllah wa bihamdihi, 100 times | Bukhari 6405 | verified |
| 14 | The dua for entering the masjid | Muslim 713 | verified |
| 15 | Two rak'ahs on entering the masjid | Bukhari 444 | verified |
| 16 | The twelve sunnah rak'ahs | Muslim 728 | verified |
| 17 | Send durood often | Muslim 408 | verified |
| 18 | The dua after the adhan | Bukhari 614 | verified |
| 19 | Dua between adhan and iqamah | Tirmidhi 212 | verified. Albani, Shakir, Zai sahih. |
| 20 | Give a gift | Al-Adab al-Mufrad 594 | verified as hasan (Albani; Ibn Hajar in Talkhis al-Habir, via sunnah.com listing and thehouseofislam.com in a web search). Source field could add "(hasan)". The dataset does not contain Adab, so the text was not read there. |
| 21 | Speak good or stay silent | Bukhari 6018 | verified |
| 22 | Do not get angry | Bukhari 6116 | verified |
| 23 | Praise Allah after eating | Tirmidhi 3458 | verified. Albani, Shakir, Maarouf hasan; Zai isnaad hasan. Add "(hasan)". |
| 24 | Pick up a dropped morsel | Muslim 2033 | verified |
| 25 | Sayyid al-Istighfar | Bukhari 6306 | verified |
| 26 | Shake hands when you meet | Abu Dawud 5212 | **needs a closer look**: Albani sahih and Arnaut sahih li-ghayrihi, but Zubair Ali Zai da'if. Tirmidhi 2727 (same report, Albani sahih, Zai da'if) has the same split. Acceptable but should be tagged "(hasan)" and reviewed by the scholar. |
| 27 | Serve your mother | Bukhari 5971 | verified |
| 28 | Keep ties with relatives | Bukhari 5986 | verified |
| 29 | Feed someone | Bukhari 12 | verified |
| 30 | Be kind to animals | Bukhari 2363 | verified |

The header comment of the seed file says the numbers follow "the common sunnah.com numbering"; the one real discrepancy found is entry 5.

## Things I could not do

- Open sunnah.com, dorar.net or islamqa.info pages directly (403 from the proxy); web search snippets stood in only for entries named above.
- Read the Tirmidhi 1858 text and Al-Adab al-Mufrad in the dataset (empty / absent).
- Confirm Urdu harakat and phrasing with a native scholar. Please proof-read.


## Applied after review (27 October)
In `scripts/seed-sunnahs.mjs`: entry 5 now cites Bukhari 5855, entry 6 cites Muslim 2024, 2028, entry 26 is tagged (hasan). Entry 50 (garment above the ankles) is disputed among scholars and is the most sensitive item: a scholar should decide whether to keep it. The Arabic/Urdu wording needs a native proof-read.
