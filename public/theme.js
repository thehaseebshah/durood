// Dark is the default; the sun / moon button on the page switches and remembers the choice. Runs first so the page never flashes the other colours.
try { if (localStorage.getItem('theme') === 'light') document.documentElement.dataset.theme = 'light'; } catch { /* private mode */ }
