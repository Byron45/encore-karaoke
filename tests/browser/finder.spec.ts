import { test, expect, type Page } from '@playwright/test';

// Three songs with plain lyrics; the simulated model gives each theme its own direction.
const songs = [
  { id: 'fiesta', title: 'Noche de fiesta', lyrics: 'Vamos a bailar toda la noche en la fiesta\nque suene la música y salten todos\nla fiesta no termina hasta el sol', date: '1998-01-01' },
  { id: 'llanto', title: 'Sin ti', lyrics: 'Me quedé solo y no paro de llorar\ntu adiós me rompió el corazón\nya no volverás y yo te extraño', date: '' },
  { id: 'guerra', title: 'Kamikaze', lyrics: 'Vuela al combate en la guerra del cielo\nel fuego mortal y la batalla final\nnacido para luchar por un ideal', date: '2005' },
];
const direction = (text: string) => { const v = [/fiesta|bailar/i.test(text) ? 1 : .1, /llorar|adiós|extraño|tristes?/i.test(text) ? 1 : .1, /guerra|batalla|combate/i.test(text) ? 1 : .1]; const n = Math.hypot(...v); return v.map(x => x / n); };

async function setup(page: Page, available: boolean, answerAfter = 0) {
  const passages: string[] = [];
  await page.route('**/api/preparation/meaning', async route => {
    const request = route.request();
    // The first answer can come late, as it does while the server checks its Python engine.
    if (request.method() === 'GET') { if (answerAfter) { await new Promise(resolve => setTimeout(resolve, answerAfter)); answerAfter = 0; } return route.fulfill({ json: { available, model: 'intfloat/multilingual-e5-small', token: 'test' } }); }
    const { kind, texts } = request.postDataJSON();
    if (kind === 'passage') passages.push(...texts);
    return route.fulfill({ json: { model: 'intfloat/multilingual-e5-small', device: 'cuda', vectors: texts.map(direction) } });
  });
  await page.goto('/');
  await page.evaluate(async list => {
    const { saveSong } = await import('/src/library-store.ts');
    for (const song of list) await saveSong({ id: song.id, title: song.title, artist: 'Prueba', duration: 30, bpm: null, notes: [], audio: new Blob(['x'], { type: 'audio/wav' }), audioName: `${song.id}.wav`, audioHash: song.id, updatedAt: new Date().toISOString(), lyrics: { raw: song.lyrics, format: 'plain', offset: 0 }, ...(song.date ? { recording: { id: song.id, title: song.title, artist: 'Prueba', duration: 30, album: '', date: song.date, disambiguation: '' } } : {}) } as never);
  }, songs);
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await expect(page.locator('.song-row')).toHaveCount(3);
  return passages;
}
const titles = (page: Page) => page.locator('.song-row strong').allInnerTexts();

test('the finder orders songs by meaning, tags them, filters them and says when nothing matches', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const passages = await setup(page, true, 2500);
  const search = page.getByRole('searchbox', { name: 'Buscar por tema o ánimo' });
  // Searched before the server said the model is there: the search waits for it instead of matching words.
  await search.fill('canciones tristes de despedida'); await search.press('Enter');
  await expect(page.getByText(/Ordenadas por parecido con «canciones tristes de despedida»/)).toBeVisible();
  expect((await titles(page))[0]).toBe('Sin ti');
  await expect(page.locator('.song-row').first().locator('.song-tags')).toContainText('Muy relacionada · Español');
  // Each song was read once; a second search reuses what the browser kept.
  expect(passages).toHaveLength(3); expect(passages[0]).toMatch(/^Noche de fiesta\. Vamos a bailar/);
  await search.fill('una noche para bailar'); await search.press('Enter');
  await expect(page.getByText(/Ordenadas por parecido con «una noche para bailar»/)).toBeVisible();
  expect((await titles(page))[0]).toBe('Noche de fiesta'); expect(passages).toHaveLength(3);

  // Filters keep the order of the search and the counter says how many are shown.
  await page.getByLabel('Década').selectOption('2000');
  expect(await titles(page)).toEqual(['Kamikaze']); await expect(page.locator('.library-list .card-heading')).toContainText('1 de 3');
  await page.getByLabel('Década').selectOption('none');
  expect(await titles(page)).toEqual(['Sin ti']);
  await page.getByLabel('Idioma').selectOption('en');
  await expect(page.getByText(/Ninguna canción coincide con «una noche para bailar» y estos filtros/)).toBeVisible();
  await page.getByRole('button', { name: 'Quitar búsqueda y filtros' }).click();
  // Back to the library's own order, all three songs.
  expect((await titles(page)).sort()).toEqual(['Kamikaze', 'Noche de fiesta', 'Sin ti']);
  await expect(search).toHaveValue('');
  // A mood button searches with its own description and says so.
  await page.getByRole('button', { name: 'Desamor', exact: true }).click();
  await expect(page.getByText('Ánimo «Desamor»: ordenadas por parecido con «desamor»', { exact: false })).toBeVisible();
  expect((await titles(page))[0]).toBe('Sin ti'); await expect(page.getByRole('button', { name: 'Desamor', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Épica', exact: true }).click();
  await expect(page.getByText('Ánimo «Épica»', { exact: false })).toBeVisible();
  expect((await titles(page))[0]).toBe('Kamikaze');
  // Without a singing history the voice filter waits for it.
  await expect(page.getByLabel('Para tu voz')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('without the meaning model the finder looks for the words in titles, artists and lyrics', async ({ page }) => {
  const passages = await setup(page, false);
  const search = page.getByRole('searchbox', { name: 'Buscar por tema o ánimo' });
  await search.fill('batalla'); await search.press('Enter');
  await expect(page.getByText(/Búsqueda por palabras/)).toBeVisible();
  expect(await titles(page)).toEqual(['Kamikaze']);
  await search.fill('trompeta'); await search.press('Enter');
  await expect(page.getByText(/Ninguna canción coincide con «trompeta»/)).toBeVisible();
  expect(passages).toHaveLength(0);
});
