# Mamulaat app API: what Seerah Quest needs

Seerah Quest (internal edition) asks the Mamulaat app two questions. It never stores more than a daily percentage and never sends anything but a phone number.

Base URL and key are set on our side with `MAMULAAT_API_URL` and `MAMULAAT_API_KEY`. Every request carries `Authorization: Bearer <key>`. Please answer within 5 seconds. Phone numbers are digits only, with the country code and no `+` (for example `923001234567`). On our side members sign up with the same WhatsApp number they use in your app.

## 1. Who is this person's murabbi?

`GET /v1/murabbi?phone=923001234567`

- `200 { "murabbi": { "name": "Hafiz Sahib", "whatsapp": "923091999001" } }`
- `200 { "murabbi": null }` the person exists but has no murabbi
- `404 { "error": "saalik_not_found" }` no such person in your app

We match `whatsapp` to a Seerah Quest account by phone number. If the murabbi has no account yet, the salik is told to ask them to sign up, and the link completes by itself when that number registers. We ask again at most once a day, so a change of murabbi on your side reaches us.

## 2. Daily mamulaat percentage

`GET /v1/mamulaat?phone=923001234567&from=2026-10-11&to=2026-10-24`

- `200 { "days": [ { "day": "2026-10-24", "percent": 80 }, ... ] }`
- `day` is `YYYY-MM-DD` in Pakistan time. `percent` is an integer 0 to 100. Days with no report are left out.
- `404 { "error": "saalik_not_found" }`

We ask for the last 14 days when a salik or their murabbi opens the screen, and cache the answer for 30 minutes. Values outside 0 to 100 and days outside the range are ignored.

Only the salik and their murabbi ever see these numbers. A masul never does.

For development, `node scripts/fake-mamulaat.mjs` runs a stand-in that follows this contract.
