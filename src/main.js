import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/newsreader/wght-italic.css';
import './ui/hud.css';
import { App } from './core/App.js';

const params = new URLSearchParams(location.search);
const app = new App({
  canvas: document.getElementById('stage'),
  hudRoot: document.getElementById('hud'),
  params,
});
app.start().catch((e) => console.error('[hidden-layers] boot failed', e));
