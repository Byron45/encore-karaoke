import { defineConfig } from 'vite';
import { musicBrainzPlugin } from './server/musicbrainz.mjs';
import { lyricsPlugin } from './server/lyrics.mjs';
import { preparationPlugin } from './server/preparation.mjs';
export default defineConfig({ plugins: [musicBrainzPlugin(), lyricsPlugin(), preparationPlugin()] });
