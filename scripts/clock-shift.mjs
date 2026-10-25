// Moves the process clock to TARGET_ISO and keeps it ticking, so date-dependent code can be tested on any day (used by npm run test:dates).
const target = Date.parse(process.env.TARGET_ISO); const off = target - Date.now(); const Real = Date;
class Shifted extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); } static now() { return Real.now() + off; } }
globalThis.Date = Shifted;
